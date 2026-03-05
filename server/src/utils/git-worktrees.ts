import { execSync } from 'child_process';
import * as path from 'path';

export interface GitWorktree {
  path: string;      // 绝对路径
  branch: string;    // 分支名，如 'main' 或 'feat/foo'
  isMain: boolean;   // 是否是主 worktree（第一个）
  commit?: string;   // HEAD commit hash（短）
}

/**
 * 列出 git repo 的所有 worktrees。
 * 如果不是 git repo 或 git 不可用，返回空数组。
 */
export function listGitWorktrees(repoPath: string): GitWorktree[] {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });

    return parseWorktreeOutput(output);
  } catch {
    return [];
  }
}

/**
 * 解析 `git worktree list --porcelain` 的输出。
 *
 * 输出格式（每个 worktree 一组，空行分隔）：
 *   worktree /absolute/path
 *   HEAD abc1234
 *   branch refs/heads/main
 *   (或 "detached" 替代 branch 行)
 */
function parseWorktreeOutput(output: string): GitWorktree[] {
  const blocks = output.trim().split(/\n\n+/);
  const result: GitWorktree[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const lines = block.split('\n');
    let wtPath = '';
    let branch = '';
    let commit = '';

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        commit = line.slice('HEAD '.length).trim().slice(0, 7);
      } else if (line.startsWith('branch ')) {
        // 'refs/heads/main' → 'main'
        branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      } else if (line === 'detached') {
        branch = `detached@${commit}`;
      }
    }

    if (!wtPath) continue;

    result.push({
      path: path.normalize(wtPath),
      branch: branch || commit || 'unknown',
      isMain: i === 0,
      commit,
    });
  }

  return result;
}

/**
 * 创建一个新的 git worktree。
 * - 如果 branch 已存在：`git worktree add <worktreePath> <branch>`
 * - 如果 branch 不存在：`git worktree add -b <branch> <worktreePath>`
 *
 * @returns 创建后的 GitWorktree 对象
 * @throws 如果 git 命令失败
 */
export function createGitWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string,
): GitWorktree {
  const absWorktreePath = path.isAbsolute(worktreePath)
    ? worktreePath
    : path.resolve(repoPath, worktreePath);

  // 检查分支是否已存在
  let branchExists = false;
  try {
    execSync(`git rev-parse --verify refs/heads/${branch}`, {
      cwd: repoPath,
      stdio: 'ignore',
      timeout: 5000,
    });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  const cmd = branchExists
    ? `git worktree add "${absWorktreePath}" "${branch}"`
    : `git worktree add -b "${branch}" "${absWorktreePath}"`;

  execSync(cmd, {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });

  return {
    path: path.normalize(absWorktreePath),
    branch,
    isMain: false,
  };
}
