import type { Database } from 'better-sqlite3';
import type { LocalPR, LocalPRStatus, ServerMessage, Session } from '@my-claudia/shared';
import { LocalPRRepository } from '../repositories/local-pr.js';
import { ProjectRepository } from '../repositories/project.js';
import { SessionRepository } from '../repositories/session.js';
import { Mutex } from 'async-mutex';
import {
  getGitStatus,
  commitAllChanges,
  getNewCommits,
  getDiff,
  getMainBranch,
  getCurrentBranch,
  isWorkingTreeClean,
  mergeBranch,
  abortMerge,
} from '../utils/git-operations.js';
import { createVirtualClient, handleRunStart } from '../server.js';

// Regex to detect review outcome from AI session messages
const REVIEW_PASSED_RE = /\[REVIEW_PASSED\]/i;
const REVIEW_FAILED_RE = /\[REVIEW_FAILED\]/i;

// How long (ms) before a reviewing/merging PR is considered stale and reset
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

export class LocalPRService {
  private prRepo: LocalPRRepository;
  private projectRepo: ProjectRepository;
  private sessionRepo: SessionRepository;
  private mergeLock = new Mutex();
  private activeReviewClients = new Map<string, unknown>(); // prId → virtualClient

  constructor(
    private db: Database,
    private broadcastToProject: (projectId: string, message: ServerMessage) => void,
  ) {
    this.prRepo = new LocalPRRepository(db);
    this.projectRepo = new ProjectRepository(db);
    this.sessionRepo = new SessionRepository(db);
  }

  // ---------------------------------------------------------------------------
  // PR Creation
  // ---------------------------------------------------------------------------

  /**
   * Create a Local PR for the given worktree path.
   * - Auto-commits any uncommitted changes
   * - Collects new commits vs base branch
   * - Stores diff summary
   */
  async createPR(
    projectId: string,
    worktreePath: string,
    options: { title?: string; description?: string; autoTriggered?: boolean } = {},
  ): Promise<LocalPR> {
    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      throw new Error(`Project ${projectId} has no rootPath`);
    }

    // Prevent duplicate active PRs for same worktree
    const existing = this.prRepo.findActiveByWorktree(worktreePath);
    if (existing) {
      throw new Error(`An active local PR already exists for this worktree (id: ${existing.id})`);
    }

    const baseBranch = await getMainBranch(worktreePath);
    const branchName = await getCurrentBranch(worktreePath);

    if (branchName === baseBranch) {
      throw new Error(`Worktree is already on the base branch (${baseBranch})`);
    }

    // Auto-commit if there are uncommitted changes
    const status = await getGitStatus(worktreePath);
    if (status.hasChanges) {
      await commitAllChanges(worktreePath);
    }

    // Validate there are new commits
    const commits = await getNewCommits(project.rootPath, branchName, baseBranch);
    if (commits.length === 0) {
      throw new Error(`No new commits on branch '${branchName}' compared to '${baseBranch}'`);
    }

    const diffSummary = await getDiff(project.rootPath, baseBranch, branchName);

    const title =
      options.title ??
      (commits.length === 1
        ? commits[0].message
        : `${branchName} (${commits.length} commits)`);

    const pr = this.prRepo.create({
      projectId,
      worktreePath,
      branchName,
      baseBranch,
      title,
      description: options.description,
      status: 'open',
      commits: commits.map((c) => c.sha),
      diffSummary,
      autoTriggered: options.autoTriggered ?? false,
    });

    this.broadcastPRUpdate(pr);
    console.log(`[LocalPRService] Created PR ${pr.id} for branch '${branchName}'`);
    return pr;
  }

  /**
   * Called on `run.completed` for regular sessions with a working directory.
   * Auto-creates a PR if the worktree has new commits and no active PR exists.
   */
  async maybeAutoCreatePR(projectId: string, worktreePath: string): Promise<LocalPR | null> {
    try {
      const project = this.projectRepo.findById(projectId);
      if (!project?.rootPath) return null;

      // Only trigger if no active PR for this worktree
      const existing = this.prRepo.findActiveByWorktree(worktreePath);
      if (existing) return null;

      const baseBranch = await getMainBranch(worktreePath);
      const branchName = await getCurrentBranch(worktreePath);
      if (branchName === baseBranch) return null;

      const commits = await getNewCommits(project.rootPath, branchName, baseBranch);
      if (commits.length === 0) return null;

      return await this.createPR(projectId, worktreePath, { autoTriggered: true });
    } catch (err) {
      console.error('[LocalPRService] maybeAutoCreatePR error:', err);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Review
  // ---------------------------------------------------------------------------

  /**
   * Start an AI review session for the given PR.
   * Uses the project's configured review provider.
   */
  async startReview(prId: string): Promise<void> {
    const pr = this.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);

    const project = this.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) throw new Error(`Project ${pr.projectId} has no rootPath`);

    if (!project.reviewProviderId) {
      console.log(`[LocalPRService] No review provider configured for project ${pr.projectId}, skipping review`);
      return;
    }

    if (this.activeReviewClients.has(prId)) {
      console.log(`[LocalPRService] Review already in progress for PR ${prId}`);
      return;
    }

    // Create background review session
    const session = this.sessionRepo.create({
      projectId: pr.projectId,
      name: `Review: ${pr.title}`,
      type: 'background',
      projectRole: 'review',
      workingDirectory: pr.worktreePath,
      providerId: project.reviewProviderId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    this.prRepo.update(prId, { status: 'reviewing', reviewSessionId: session.id });
    this.broadcastPRUpdate(this.prRepo.findById(prId)!);

    const reviewPrompt = this.buildReviewPrompt(pr);
    const clientId = `localpr_review_${prId}`;

    const virtualClient = createVirtualClient(clientId, {
      send: (msg: ServerMessage) => {
        if (msg.type === 'run_completed') {
          this.onReviewSessionComplete(prId, session.id).catch((err) =>
            console.error(`[LocalPRService] Review completion error for PR ${prId}:`, err),
          );
          this.activeReviewClients.delete(prId);
        }
      },
    });

    this.activeReviewClients.set(prId, virtualClient);

    handleRunStart(
      virtualClient,
      {
        type: 'run_start',
        clientRequestId: `localpr_review_${prId}_${Date.now()}`,
        sessionId: session.id,
        input: reviewPrompt,
        workingDirectory: pr.worktreePath,
        providerId: project.reviewProviderId,
      },
      this.db as any,
    );

    console.log(`[LocalPRService] Started review session ${session.id} for PR ${prId}`);
  }

  private buildReviewPrompt(pr: LocalPR): string {
    return `You are a code reviewer. Your job is to review the following diff, fix any issues directly in the files, commit your fixes, and output a review verdict.

## Branch
\`${pr.branchName}\` → \`${pr.baseBranch}\`

## Diff
\`\`\`diff
${pr.diffSummary ?? '(no diff available)'}
\`\`\`

## Instructions
1. Review the diff for bugs, security issues, code quality problems, or missing error handling.
2. If you find issues, fix them directly in the files in the working directory.
3. After fixing, commit your changes with: git add -A && git commit -m "fix: review fixes for ${pr.branchName}"
4. At the end of your response, output ONE of:
   - [REVIEW_PASSED] — if no issues found (or all issues were fixed)
   - [REVIEW_FAILED] — only if you found critical issues you could NOT fix

Be thorough but pragmatic. Minor style issues do not warrant REVIEW_FAILED.`;
  }

  private async onReviewSessionComplete(prId: string, sessionId: string): Promise<void> {
    const pr = this.prRepo.findById(prId);
    if (!pr || pr.status !== 'reviewing') return;

    // Extract outcome from last assistant messages
    const messages = this.db
      .prepare(
        `SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 5`,
      )
      .all(sessionId) as { content: string }[];

    let passed = true;
    let reviewNotes = '';

    for (const msg of messages) {
      if (REVIEW_FAILED_RE.test(msg.content)) {
        passed = false;
        reviewNotes = msg.content.slice(-2000); // last 2KB of the message
        break;
      }
      if (REVIEW_PASSED_RE.test(msg.content)) {
        passed = true;
        break;
      }
    }

    const newStatus: LocalPRStatus = passed ? 'approved' : 'review_failed';
    this.prRepo.update(prId, { status: newStatus, reviewNotes: reviewNotes || undefined });
    this.broadcastPRUpdate(this.prRepo.findById(prId)!);
    console.log(`[LocalPRService] Review complete for PR ${prId}: ${newStatus}`);
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  /**
   * Attempt to merge an approved PR into the base branch.
   * Uses a mutex to serialize all merge operations.
   */
  async mergePR(prId: string): Promise<void> {
    const pr = this.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);

    const project = this.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) throw new Error(`Project ${pr.projectId} has no rootPath`);

    return this.mergeLock.runExclusive(async () => {
      // Re-fetch inside lock to ensure status hasn't changed
      const freshPR = this.prRepo.findById(prId);
      if (!freshPR || freshPR.status !== 'approved') return;

      // Verify main worktree is clean
      const mainClean = await isWorkingTreeClean(project.rootPath!);
      if (!mainClean) {
        console.log(`[LocalPRService] Main worktree is dirty, deferring merge of PR ${prId}`);
        return;
      }

      this.prRepo.update(prId, { status: 'merging' });
      this.broadcastPRUpdate(this.prRepo.findById(prId)!);

      try {
        // Checkout base branch in main worktree
        const { execFile: execFileCb } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFileCb);
        await execFileAsync('git', ['checkout', pr.baseBranch], { cwd: project.rootPath! });

        const result = await mergeBranch(
          project.rootPath!,
          pr.branchName,
          `Merge Local PR: ${pr.title}`,
        );

        if (result.success) {
          this.prRepo.update(prId, { status: 'merged', mergedAt: Date.now() });
          this.broadcastPRUpdate(this.prRepo.findById(prId)!);
          console.log(`[LocalPRService] Merged PR ${prId} into ${pr.baseBranch}`);
        } else {
          console.warn(
            `[LocalPRService] Merge conflict for PR ${prId}: ${result.conflicts?.join(', ')}`,
          );
          await abortMerge(project.rootPath!);
          this.prRepo.update(prId, { status: 'conflict' });
          this.broadcastPRUpdate(this.prRepo.findById(prId)!);
          await this.startConflictResolution(prId);
        }
      } catch (err) {
        console.error(`[LocalPRService] Merge error for PR ${prId}:`, err);
        this.prRepo.update(prId, { status: 'approved' }); // reset so it can retry
        this.broadcastPRUpdate(this.prRepo.findById(prId)!);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Conflict Resolution
  // ---------------------------------------------------------------------------

  /**
   * Start an AI session to resolve merge conflicts for the given PR.
   * The AI will rebase the feature branch onto the latest base branch and commit.
   */
  async startConflictResolution(prId: string): Promise<void> {
    const pr = this.prRepo.findById(prId);
    if (!pr) return;

    const project = this.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) return;

    const providerId = project.reviewProviderId ?? project.providerId;
    if (!providerId) {
      console.warn(`[LocalPRService] No provider for conflict resolution on PR ${prId}`);
      return;
    }

    const session = this.sessionRepo.create({
      projectId: pr.projectId,
      name: `Conflict resolution: ${pr.title}`,
      type: 'background',
      projectRole: 'review',
      workingDirectory: project.rootPath,
      providerId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    this.prRepo.update(prId, { conflictSessionId: session.id });

    const conflictPrompt = `You are a git expert. The branch '${pr.branchName}' has a merge conflict when merging into '${pr.baseBranch}'.

Your task:
1. In the repository at the current working directory, rebase '${pr.branchName}' onto '${pr.baseBranch}':
   git checkout ${pr.branchName}
   git rebase ${pr.baseBranch}
2. Resolve any conflicts by editing the conflicted files (look for <<<<<<, =======, >>>>>>> markers).
3. After resolving each file: git add <file>
4. Continue the rebase: git rebase --continue
5. When done, go back to the base branch and verify:
   git checkout ${pr.baseBranch}
   git merge --no-ff ${pr.branchName} -m "Merge Local PR: ${pr.title}"

If the rebase succeeds, output: [CONFLICT_RESOLVED]
If you cannot resolve it, output: [CONFLICT_UNRESOLVED]`;

    const clientId = `localpr_conflict_${prId}`;

    const virtualClient = createVirtualClient(clientId, {
      send: (msg: ServerMessage) => {
        if (msg.type === 'run_completed') {
          this.onConflictSessionComplete(prId, session.id).catch((err) =>
            console.error(`[LocalPRService] Conflict completion error for PR ${prId}:`, err),
          );
        }
      },
    });

    handleRunStart(
      virtualClient,
      {
        type: 'run_start',
        clientRequestId: `localpr_conflict_${prId}_${Date.now()}`,
        sessionId: session.id,
        input: conflictPrompt,
        workingDirectory: project.rootPath,
        providerId,
      },
      this.db as any,
    );

    console.log(`[LocalPRService] Started conflict resolution session ${session.id} for PR ${prId}`);
  }

  private async onConflictSessionComplete(prId: string, sessionId: string): Promise<void> {
    const pr = this.prRepo.findById(prId);
    if (!pr || pr.status !== 'conflict') return;

    const messages = this.db
      .prepare(
        `SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 5`,
      )
      .all(sessionId) as { content: string }[];

    const resolved = messages.some((m) => /\[CONFLICT_RESOLVED\]/i.test(m.content));

    if (resolved) {
      // Reset to approved so the scheduler picks it up for merging
      this.prRepo.update(prId, { status: 'approved' });
      this.broadcastPRUpdate(this.prRepo.findById(prId)!);
      console.log(`[LocalPRService] Conflict resolved for PR ${prId}, ready to merge`);
    } else {
      // Leave as conflict — user must handle manually
      console.warn(`[LocalPRService] Conflict could not be resolved for PR ${prId}`);
      this.broadcastPRUpdate(this.prRepo.findById(prId)!);
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduler Tick
  // ---------------------------------------------------------------------------

  async tick(): Promise<void> {
    try {
      await this.processStale();
      await this.processPendingReviews();
      await this.processPendingMerges();
    } catch (err) {
      console.error('[LocalPRService] tick error:', err);
    }
  }

  /** Reset stale reviewing/merging PRs that have been stuck for too long. */
  private async processStale(): Promise<void> {
    const threshold = Date.now() - STALE_TIMEOUT_MS;
    const stale = this.prRepo.findInProgress().filter((pr) => pr.updatedAt < threshold);

    for (const pr of stale) {
      const resetStatus: LocalPRStatus = pr.status === 'reviewing' ? 'open' : 'approved';
      this.prRepo.update(pr.id, { status: resetStatus });
      this.activeReviewClients.delete(pr.id);
      this.broadcastPRUpdate(this.prRepo.findById(pr.id)!);
      console.log(
        `[LocalPRService] Reset stale PR ${pr.id} (${pr.status} → ${resetStatus})`,
      );
    }
  }

  private async processPendingReviews(): Promise<void> {
    const pending = this.prRepo.findPendingReview();

    for (const pr of pending) {
      const project = this.projectRepo.findById(pr.projectId);
      if (!project?.reviewProviderId) continue; // no review provider configured
      if (this.activeReviewClients.has(pr.id)) continue; // already running

      await this.startReview(pr.id).catch((err) =>
        console.error(`[LocalPRService] Failed to start review for PR ${pr.id}:`, err),
      );
    }
  }

  private async processPendingMerges(): Promise<void> {
    const pending = this.prRepo.findPendingMerge();

    for (const pr of pending) {
      await this.mergePR(pr.id).catch((err) =>
        console.error(`[LocalPRService] Failed to merge PR ${pr.id}:`, err),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private broadcastPRUpdate(pr: LocalPR): void {
    this.broadcastToProject(pr.projectId, {
      type: 'local_pr_update',
      projectId: pr.projectId,
      pr,
    });
  }

  // Expose repository for route handlers
  getRepo(): LocalPRRepository {
    return this.prRepo;
  }
}
