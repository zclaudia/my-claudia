import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
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
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
  const output = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  return output.trim();
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
