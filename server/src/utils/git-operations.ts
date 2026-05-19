import { execFile as execFileCb } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

export class GitOperationError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'GitOperationError';
    this.stderr = stderr;
  }
}

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const stderr = (e.stderr ?? '').toString();
    const stdout = (e.stdout ?? '').toString();
    const message = stderr.trim() || stdout.trim() || e.message || 'git command failed';
    throw new GitOperationError(message, stderr);
  }
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: number;
}

export interface GitStatusResult {
  hasChanges: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export type GitFileDiffKind = 'staged' | 'unstaged' | 'untracked';

export interface GitMergeResult {
  success: boolean;
  conflicts?: string[];
}

/**
 * Returns the status of the working tree at the given path.
 */
export async function getGitStatus(repoPath: string): Promise<GitStatusResult> {
  const output = await git(['status', '--porcelain=v1'], repoPath);
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of output.split('\n')) {
    if (!line) continue;
    const xy = line.slice(0, 2);
    const file = line.slice(3);
    const x = xy[0]; // index (staged)
    const y = xy[1]; // worktree (unstaged)

    if (xy === '??') {
      untracked.push(file);
    } else {
      if (x !== ' ' && x !== '?') staged.push(file);
      if (y !== ' ' && y !== '?') unstaged.push(file);
    }
  }

  return {
    hasChanges: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
    staged,
    unstaged,
    untracked,
  };
}

/**
 * Returns true if the working tree has no uncommitted changes.
 * Untracked files are ignored — they don't block git merge/checkout.
 */
export async function isWorkingTreeClean(repoPath: string): Promise<boolean> {
  const status = await getGitStatus(repoPath);
  return status.staged.length === 0 && status.unstaged.length === 0;
}

/**
 * Stages all changes and commits with an auto-generated message based on `git diff --stat`.
 * Returns the SHA of the new commit.
 */
export async function commitAllChanges(repoPath: string): Promise<string> {
  // Stage everything
  await git(['add', '-A'], repoPath);

  // Generate message from stat
  const stat = await git(['diff', '--cached', '--stat'], repoPath).catch(() => '');
  const lines = stat.split('\n').filter(Boolean);

  let message = 'chore: auto-commit before PR';
  if (lines.length > 0) {
    // Last line is summary like "3 files changed, 42 insertions(+), 5 deletions(-)"
    const summary = lines[lines.length - 1].trim();
    const fileLines = lines.slice(0, -1).map((l) => l.split('|')[0].trim()).filter(Boolean);
    if (fileLines.length === 1) {
      message = `chore: update ${fileLines[0]}`;
    } else if (fileLines.length > 1) {
      message = `chore: update ${fileLines[0]} (+${fileLines.length - 1} files) — ${summary}`;
    }
  }

  await git(['commit', '-m', message], repoPath);

  const sha = await git(['rev-parse', 'HEAD'], repoPath);
  return sha.trim();
}

/**
 * Returns commits in `branch` that are not reachable from `baseBranch`.
 */
export async function getNewCommits(
  repoPath: string,
  branch: string,
  baseBranch: string,
): Promise<CommitInfo[]> {
  // Format: sha\x1fmessage\x1fauthor\x1fdate
  const SEP = '\x1f';
  const output = await git(
    [
      'log',
      `${baseBranch}..${branch}`,
      `--format=%H${SEP}%s${SEP}%an${SEP}%at`,
      '--no-merges',
    ],
    repoPath,
  );

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, message, author, dateStr] = line.split(SEP);
      return { sha, message, author, date: parseInt(dateStr, 10) * 1000 };
    });
}

/**
 * Returns the full diff between `from` and `to` refs.
 * Truncated to maxBytes (default 100KB) to stay within DB limits.
 */
export async function getDiff(
  repoPath: string,
  from: string,
  to: string,
  maxBytes = 100 * 1024,
): Promise<string> {
  const diff = await git(['diff', from, to], repoPath);
  if (diff.length <= maxBytes) return diff;
  return diff.slice(0, maxBytes) + '\n\n[diff truncated]';
}

function truncateDiff(diff: string, maxBytes: number): string {
  if (diff.length <= maxBytes) return diff;
  return diff.slice(0, maxBytes) + '\n\n[diff truncated]';
}

function resolveRepoFile(repoPath: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new GitOperationError('File path must be relative to the worktree', '');
  }
  const root = path.resolve(repoPath);
  const absolute = path.resolve(root, filePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new GitOperationError('File path escapes the worktree', '');
  }
  return absolute;
}

function renderUntrackedFileDiff(filePath: string, content: string): string {
  const lines = content.length === 0
    ? []
    : content.endsWith('\n')
    ? content.slice(0, -1).split('\n')
    : content.split('\n');
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join('\n');
}

export async function getFileDiff(
  repoPath: string,
  filePath: string,
  kind: GitFileDiffKind,
  maxBytes = 200 * 1024,
): Promise<string> {
  if (kind === 'staged') {
    return truncateDiff(await git(['diff', '--cached', '--', filePath], repoPath), maxBytes);
  }
  if (kind === 'unstaged') {
    return truncateDiff(await git(['diff', '--', filePath], repoPath), maxBytes);
  }

  const absolutePath = resolveRepoFile(repoPath, filePath);
  const content = fs.readFileSync(absolutePath, 'utf-8');
  return truncateDiff(renderUntrackedFileDiff(filePath, content), maxBytes);
}

/**
 * Returns the main branch name (master or main).
 */
export async function getMainBranch(repoPath: string): Promise<string> {
  // Try to read from symbolic ref HEAD of remote origin
  try {
    const ref = await git(
      ['rev-parse', '--abbrev-ref', 'origin/HEAD'],
      repoPath,
    );
    const branch = ref.trim().replace(/^origin\//, '');
    if (branch && branch !== 'HEAD') return branch;
  } catch {
    // fall through
  }

  // Fall back to checking local branches
  try {
    const branches = await git(['branch', '--list', 'main', 'master'], repoPath);
    if (branches.includes('main')) return 'main';
    if (branches.includes('master')) return 'master';
  } catch {
    // fall through
  }

  return 'master';
}

/**
 * Returns the current branch name in a worktree.
 * Handles orphan branches (no commits yet) by falling back to symbolic-ref.
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  try {
    const output = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
    return output.trim();
  } catch {
    // HEAD doesn't resolve (orphan branch with no commits) — read symbolic ref directly
    const ref = await git(['symbolic-ref', '--short', 'HEAD'], repoPath);
    return ref.trim();
  }
}

/**
 * Returns true if the repo/worktree at repoPath has at least one commit.
 */
export async function hasCommits(repoPath: string): Promise<boolean> {
  try {
    await git(['rev-parse', 'HEAD'], repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merges `branch` into the current branch of `repoPath` using --no-ff.
 * Returns { success: true } on success or { success: false, conflicts } on conflict.
 */
export async function mergeBranch(
  repoPath: string,
  branch: string,
  mergeMessage?: string,
): Promise<GitMergeResult> {
  try {
    const msg = mergeMessage ?? `Merge branch '${branch}'`;
    await git(['merge', '--no-ff', branch, '-m', msg], repoPath);
    return { success: true };
  } catch (err: unknown) {
    // Abort and report conflicts
    await git(['merge', '--abort'], repoPath).catch(() => {});
    const execErr = err as { stderr?: string; stdout?: string };
    const conflictOutput = execErr.stderr || execErr.stdout || '';
    const conflicts = conflictOutput
      .split('\n')
      .filter((l: string) => l.includes('CONFLICT'))
      .map((l: string) => l.trim());
    return { success: false, conflicts };
  }
}

/**
 * Aborts an in-progress merge. No-ops if no merge is in progress.
 */
export async function abortMerge(repoPath: string): Promise<void> {
  await git(['merge', '--abort'], repoPath).catch(() => {});
}

/**
 * Remove a git worktree and optionally delete its branch.
 * @param mainRepoPath - The main repository path (not the worktree itself)
 * @param worktreePath - Absolute path of the worktree to remove
 * @param branchName - If provided, delete this branch after removing the worktree
 */
export async function removeWorktree(
  mainRepoPath: string,
  worktreePath: string,
  branchName?: string,
): Promise<void> {
  await git(['worktree', 'remove', '--force', worktreePath], mainRepoPath).catch((err) => {
    console.warn(`[git] Failed to remove worktree ${worktreePath}:`, err.message);
  });
  if (branchName) {
    await git(['branch', '-D', branchName], mainRepoPath).catch((err) => {
      console.warn(`[git] Failed to delete branch ${branchName}:`, err.message);
    });
  }
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream?: string;
}

/**
 * Lists all local and remote branches.
 */
export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
  const SEP = '\x1f';
  // %(HEAD) = '*' for current, ' ' otherwise. %(refname:short) e.g. main, origin/main.
  const output = await git(
    [
      'branch',
      '-a',
      `--format=%(HEAD)${SEP}%(refname:short)${SEP}%(upstream:short)`,
    ],
    repoPath,
  );

  const branches: BranchInfo[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [head, refname, upstream] = line.split(SEP);
    if (!refname) continue;
    // Skip the HEAD pointer ref like 'origin/HEAD -> origin/main'
    if (refname.includes(' -> ')) continue;
    branches.push({
      name: refname,
      isRemote: refname.startsWith('origin/') || refname.includes('/HEAD'),
      isCurrent: head === '*',
      upstream: upstream && upstream.trim() ? upstream.trim() : undefined,
    });
  }
  return branches;
}

/**
 * Returns the last N commits. If `branch` is omitted, uses HEAD.
 */
export async function getCommitLog(
  repoPath: string,
  limit: number = 50,
  branch?: string,
): Promise<Array<CommitInfo & { shortSha: string }>> {
  const SEP = '\x1f';
  const args = [
    'log',
    `-n`,
    String(limit),
    `--format=%H${SEP}%h${SEP}%s${SEP}%an${SEP}%at`,
  ];
  if (branch) args.push(branch);
  const output = await git(args, repoPath).catch(() => '');
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, shortSha, message, author, dateStr] = line.split(SEP);
      return {
        sha,
        shortSha,
        message,
        author,
        date: parseInt(dateStr, 10) * 1000,
      };
    });
}

/**
 * Returns ahead/behind counts between `branch` and `baseBranch`.
 * `ahead` = commits in `branch` not in base; `behind` = commits in base not in `branch`.
 */
export async function getAheadBehind(
  repoPath: string,
  branch: string,
  baseBranch: string,
): Promise<{ ahead: number; behind: number }> {
  try {
    const out = await git(
      ['rev-list', '--left-right', '--count', `${baseBranch}...${branch}`],
      repoPath,
    );
    // Output is "behind\tahead"
    const [behind, ahead] = out.trim().split(/\s+/).map((n) => parseInt(n, 10));
    return {
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export interface StashEntry {
  index: number;
  message: string;
  date: number;
}

export async function listStash(repoPath: string): Promise<StashEntry[]> {
  const SEP = '\x1f';
  const output = await git(
    ['stash', 'list', `--format=%gd${SEP}%s${SEP}%at`],
    repoPath,
  ).catch(() => '');
  const entries: StashEntry[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [ref, message, dateStr] = line.split(SEP);
    // ref like "stash@{0}" — extract index
    const match = ref?.match(/stash@\{(\d+)\}/);
    if (!match) continue;
    entries.push({
      index: parseInt(match[1], 10),
      message: message ?? '',
      date: parseInt(dateStr, 10) * 1000,
    });
  }
  return entries;
}

export async function createStash(repoPath: string, message?: string): Promise<void> {
  const args = ['stash', 'push'];
  if (message && message.trim()) {
    args.push('-m', message.trim());
  }
  await git(args, repoPath);
}

export async function applyStash(repoPath: string, index: number): Promise<void> {
  await git(['stash', 'apply', `stash@{${index}}`], repoPath);
}

export async function dropStash(repoPath: string, index: number): Promise<void> {
  await git(['stash', 'drop', `stash@{${index}}`], repoPath);
}

export async function stageFiles(repoPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  await git(['add', '--', ...files], repoPath);
}

export async function unstageFiles(repoPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  // Use `reset HEAD --` so untracked files become untracked again rather than removed.
  await git(['reset', 'HEAD', '--', ...files], repoPath);
}

/**
 * Commits whatever is currently staged with `message`. Throws if there is nothing staged.
 * Returns the new HEAD sha.
 */
export async function commitChanges(repoPath: string, message: string): Promise<string> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new GitOperationError('Commit message is required', '');
  }
  await git(['commit', '-m', trimmed], repoPath);
  const sha = await git(['rev-parse', 'HEAD'], repoPath);
  return sha.trim();
}

export async function fetchRemote(repoPath: string, remote: string = 'origin'): Promise<void> {
  await git(['fetch', remote], repoPath);
}

export async function pullRemote(
  repoPath: string,
  remote: string = 'origin',
  branch?: string,
): Promise<void> {
  const args = ['pull', '--ff-only', remote];
  if (branch) args.push(branch);
  await git(args, repoPath);
}

export async function pushRemote(
  repoPath: string,
  remote: string = 'origin',
  branch?: string,
  force: boolean = false,
): Promise<void> {
  const args = ['push'];
  if (force) args.push('--force-with-lease');
  args.push(remote);
  if (branch) args.push(branch);
  await git(args, repoPath);
}
