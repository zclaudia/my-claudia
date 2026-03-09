import type { Database } from 'better-sqlite3';
import type { LocalPR, LocalPRStatus, ServerMessage, Session } from '@my-claudia/shared';
import { LocalPRRepository } from '../repositories/local-pr.js';
import { ProjectRepository } from '../repositories/project.js';
import { SessionRepository } from '../repositories/session.js';
import { WorktreeConfigRepository } from '../repositories/worktree-config.js';
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
  removeWorktree,
} from '../utils/git-operations.js';
import { createVirtualClient, handleRunStart } from '../server.js';

// Regex to detect review outcome from AI session messages
const REVIEW_PASSED_RE = /\[REVIEW_PASSED\]/i;
const REVIEW_FAILED_RE = /\[REVIEW_FAILED\]/i;

// How long (ms) before a reviewing/merging PR is considered stale and reset
const STALE_TIMEOUT_MS = 30 * 60 * 1000;

// Maximum number of merged/closed PRs to keep per project
const MAX_FINISHED_PRS_PER_PROJECT = 10;

export class LocalPRService {
  private prRepo: LocalPRRepository;
  private projectRepo: ProjectRepository;
  private sessionRepo: SessionRepository;
  private wtConfigRepo: WorktreeConfigRepository;
  private mergeLock = new Mutex();
  private activeReviewClients = new Map<string, unknown>(); // prId → virtualClient

  constructor(
    private db: Database,
    private broadcastToProject: (projectId: string, message: ServerMessage) => void,
  ) {
    this.prRepo = new LocalPRRepository(db);
    this.projectRepo = new ProjectRepository(db);
    this.sessionRepo = new SessionRepository(db);
    this.wtConfigRepo = new WorktreeConfigRepository(db);
  }

  // ---------------------------------------------------------------------------
  // Session Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Archive review/conflict sessions associated with a PR.
   * Called when a PR is merged or closed — the sessions are no longer relevant.
   */
  archiveRelatedSessions(pr: LocalPR): void {
    const now = Date.now();
    const sessionIds = [pr.reviewSessionId, pr.conflictSessionId].filter(Boolean) as string[];
    if (sessionIds.length === 0) return;

    const stmt = this.db.prepare('UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL');
    for (const sid of sessionIds) {
      stmt.run(now, now, sid);
    }
    console.log(`[LocalPRService] Archived ${sessionIds.length} session(s) for PR ${pr.id}`);
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
    options: { title?: string; description?: string; baseBranch?: string; autoTriggered?: boolean; autoReview?: boolean } = {},
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

    const baseBranch = options.baseBranch || await getMainBranch(worktreePath);
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

    // Atomic re-check + insert to prevent race conditions (async git ops above create a window)
    const pr = this.db.transaction(() => {
      const duplicate = this.prRepo.findActiveByWorktree(worktreePath);
      if (duplicate) return duplicate;

      return this.prRepo.create({
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
        autoReview: options.autoReview ?? false,
      });
    })();

    this.broadcastPRUpdate(pr);
    console.log(`[LocalPRService] Created PR ${pr.id} for branch '${branchName}'`);
    return pr;
  }

  /**
   * Called on `run.completed` for regular sessions with a working directory.
   * Only auto-creates a PR if the worktree has `autoCreatePR` enabled in its config.
   * If an active PR already exists and is safe to update, refreshes its commits/diff.
   */
  async maybeAutoCreatePR(projectId: string, worktreePath: string): Promise<LocalPR | null> {
    try {
      // Check worktree-level config
      const wtConfig = this.wtConfigRepo.findOne(projectId, worktreePath);
      if (!wtConfig?.autoCreatePR) return null;

      const project = this.projectRepo.findById(projectId);
      if (!project?.rootPath) return null;

      const baseBranch = await getMainBranch(worktreePath);
      const branchName = await getCurrentBranch(worktreePath);
      if (branchName === baseBranch) return null;

      const commits = await getNewCommits(project.rootPath, branchName, baseBranch);
      if (commits.length === 0) return null;

      // If an active PR already exists, try to update it
      const existing = this.prRepo.findActiveByWorktree(worktreePath);
      if (existing) {
        return this.maybeRefreshPR(existing, project.rootPath, commits, baseBranch, branchName);
      }

      return await this.createPR(projectId, worktreePath, {
        autoTriggered: true,
        autoReview: wtConfig.autoReview,
      });
    } catch (err) {
      console.error('[LocalPRService] maybeAutoCreatePR error:', err);
      return null;
    }
  }

  /**
   * Refresh an existing PR's commits and diff if it's in a safe state.
   * Skips update when the PR is being reviewed or merged to avoid interfering.
   */
  private async maybeRefreshPR(
    pr: LocalPR,
    rootPath: string,
    commits: Array<{ sha: string; message: string }>,
    baseBranch: string,
    branchName: string,
    options: { resetReviewStateOnCommitChange?: boolean } = {},
  ): Promise<LocalPR | null> {
    // Don't touch PRs that are currently being processed
    const busyStatuses: LocalPRStatus[] = ['reviewing', 'merging', 'conflict'];
    if (busyStatuses.includes(pr.status)) {
      console.log(`[LocalPRService] PR ${pr.id} is ${pr.status}, skipping refresh`);
      return null;
    }

    const newShas = commits.map((c) => c.sha);
    const oldShas = pr.commits ?? [];

    // Nothing changed
    if (newShas.length === oldShas.length && newShas.every((s, i) => s === oldShas[i])) {
      return null;
    }

    const diffSummary = await getDiff(rootPath, baseBranch, branchName);

    const shouldResetReviewState = options.resetReviewStateOnCommitChange ?? true;
    // If review was done on old commits, reset to open so it can be re-reviewed.
    // When commit changes are produced by the review session itself, caller can preserve the verdict.
    const newStatus: LocalPRStatus = shouldResetReviewState &&
      (pr.status === 'approved' || pr.status === 'review_failed')
      ? 'open'
      : pr.status;

    const updated = this.prRepo.update(pr.id, {
      commits: newShas,
      diffSummary,
      status: newStatus,
    });

    this.broadcastPRUpdate(updated);
    console.log(`[LocalPRService] Refreshed PR ${pr.id}: ${oldShas.length} → ${newShas.length} commits${newStatus !== pr.status ? `, status ${pr.status} → ${newStatus}` : ''}`);
    return updated;
  }

  /**
   * After a PR transitions out of a busy state (reviewing/merging/conflict),
   * check if the worktree has new commits that need to be captured.
   */
  private async refreshAfterBusyState(
    prId: string,
    options: { resetReviewStateOnCommitChange?: boolean } = {},
  ): Promise<void> {
    try {
      const pr = this.prRepo.findById(prId);
      if (!pr) return;

      const project = this.projectRepo.findById(pr.projectId);
      if (!project?.rootPath) return;

      const baseBranch = await getMainBranch(pr.worktreePath);
      const branchName = await getCurrentBranch(pr.worktreePath);
      if (branchName === baseBranch) return;

      const commits = await getNewCommits(project.rootPath, branchName, baseBranch);
      if (commits.length === 0) return;

      await this.maybeRefreshPR(pr, project.rootPath, commits, baseBranch, branchName, options);
    } catch (err) {
      console.error(`[LocalPRService] refreshAfterBusyState error for PR ${prId}:`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Review
  // ---------------------------------------------------------------------------

  /**
   * Start an AI review session for the given PR.
   * @param prId - The local PR to review
   * @param overrideProviderId - Optional provider ID (for manual trigger). Falls back to project.reviewProviderId → project.providerId.
   */
  async startReview(prId: string, overrideProviderId?: string): Promise<void> {
    const pr = this.prRepo.findById(prId);
    if (!pr) throw new Error(`Local PR not found: ${prId}`);

    const project = this.projectRepo.findById(pr.projectId);
    if (!project?.rootPath) throw new Error(`Project ${pr.projectId} has no rootPath`);

    const providerId = overrideProviderId || project.reviewProviderId || project.providerId;
    if (!providerId) {
      throw new Error(`No provider available for review on project ${pr.projectId}`);
    }

    if (this.activeReviewClients.has(prId)) {
      console.log(`[LocalPRService] Review already in progress for PR ${prId}`);
      return;
    }

    // Create background review session (read-only, hidden from sidebar)
    const session = this.sessionRepo.create({
      projectId: pr.projectId,
      name: `Review: ${pr.title}`,
      type: 'background',
      projectRole: 'review',
      workingDirectory: pr.worktreePath,
      providerId,
      isReadOnly: true,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    this.prRepo.update(prId, { status: 'reviewing', reviewSessionId: session.id });
    // Broadcast new session so the frontend store includes it immediately
    this.broadcastToProject(pr.projectId, { type: 'sessions_created', session });
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
        providerId,
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

    // Check for commits that arrived during the review
    await this.refreshAfterBusyState(prId, { resetReviewStateOnCommitChange: false });
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
      if (!freshPR) throw new Error(`Local PR not found: ${prId}`);
      if (!['open', 'approved', 'conflict'].includes(freshPR.status)) {
        throw new Error(`Cannot merge PR in status '${freshPR.status}'`);
      }

      // Manual merge from open/conflict should go through approved -> merging transition.
      if (freshPR.status !== 'approved') {
        this.prRepo.update(prId, { status: 'approved' });
        this.broadcastPRUpdate(this.prRepo.findById(prId)!);
      }

      // Verify main worktree is clean
      const mainClean = await isWorkingTreeClean(project.rootPath!);
      if (!mainClean) {
        throw new Error(
          `Main worktree is dirty for project ${project.id}. Commit or stash changes before merging PR ${prId}.`,
        );
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
          const mergedPR = this.prRepo.findById(prId)!;
          this.broadcastPRUpdate(mergedPR);
          this.archiveRelatedSessions(mergedPR);
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

        // Check for commits that arrived during the merge attempt
        await this.refreshAfterBusyState(prId);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Conflict Resolution
  // ---------------------------------------------------------------------------

  /**
   * Start an AI session to resolve merge conflicts for the given PR.
   * The AI rebases the feature branch onto the base branch in the feature worktree.
   * Merge is left to the normal mergePR flow after re-review.
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
      workingDirectory: pr.worktreePath,
      providerId,
      isReadOnly: true,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    this.prRepo.update(prId, { conflictSessionId: session.id });
    this.broadcastToProject(pr.projectId, { type: 'sessions_created', session });

    const conflictPrompt = `You are a git expert. The branch '${pr.branchName}' has a merge conflict when merging into '${pr.baseBranch}'.

Your task:
1. You are in the worktree for branch '${pr.branchName}'. Rebase onto '${pr.baseBranch}':
   git rebase ${pr.baseBranch}
2. Resolve any conflicts by editing the conflicted files (look for <<<<<<, =======, >>>>>>> markers).
3. After resolving each file: git add <file>
4. Continue the rebase: git rebase --continue
5. Repeat steps 2-4 until the rebase completes.

IMPORTANT: Do NOT merge into ${pr.baseBranch}. Only rebase this branch. The merge will be handled separately.

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
        workingDirectory: pr.worktreePath,
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
      // Reset to open so the PR goes through review again (rebase changed the code)
      this.prRepo.update(prId, { status: 'open' });
      this.broadcastPRUpdate(this.prRepo.findById(prId)!);
      console.log(`[LocalPRService] Conflict resolved for PR ${prId}, returning to open for re-review`);

      // Check for commits that arrived during conflict resolution
      await this.refreshAfterBusyState(prId);
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
      await this.cleanupFinishedPRs();
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
      await this.refreshAfterBusyState(pr.id);
    }
  }

  private async processPendingReviews(): Promise<void> {
    // Only auto-review PRs that have auto_review enabled
    const pending = this.prRepo.findPendingAutoReview();

    for (const pr of pending) {
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

  /**
   * Remove old merged/closed PRs beyond the retention limit per project.
   * Cleans up: git worktree, git branch, related sessions, and DB record.
   */
  private async cleanupFinishedPRs(): Promise<void> {
    const projects = this.projectRepo.findAll();

    for (const project of projects) {
      const allPRs = this.prRepo.findByProjectId(project.id);
      // Keep only merged/closed, sorted newest first (findByProjectId already orders by created_at DESC)
      const finished = allPRs.filter((pr) => pr.status === 'merged' || pr.status === 'closed');
      if (finished.length <= MAX_FINISHED_PRS_PER_PROJECT) continue;

      const toRemove = finished.slice(MAX_FINISHED_PRS_PER_PROJECT);
      for (const pr of toRemove) {
        try {
          // Clean up git worktree + branch
          if (project.rootPath && pr.worktreePath) {
            await removeWorktree(project.rootPath, pr.worktreePath, pr.branchName);
          }
          // Delete related sessions from DB
          this.deleteRelatedSessions(pr);
          // Delete PR record
          this.prRepo.delete(pr.id);
          // Notify frontend to remove this PR
          this.broadcastToProject(pr.projectId, {
            type: 'local_pr_deleted',
            projectId: pr.projectId,
            prId: pr.id,
          });
          console.log(`[LocalPRService] Cleaned up old PR ${pr.id} (${pr.status}: ${pr.title})`);
        } catch (err) {
          console.warn(`[LocalPRService] Failed to cleanup PR ${pr.id}:`, err);
        }
      }
    }
  }

  /** Permanently delete sessions associated with a PR. */
  private deleteRelatedSessions(pr: LocalPR): void {
    const sessionIds = [pr.reviewSessionId, pr.conflictSessionId].filter(Boolean) as string[];
    for (const sid of sessionIds) {
      try {
        this.sessionRepo.delete(sid);
      } catch {
        // Session may already be deleted
      }
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
