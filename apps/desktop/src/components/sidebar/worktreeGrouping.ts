import type { Session, GitWorktree } from '@my-claudia/shared';

export interface WorktreeGroup {
  key: string;           // workingDirectory path or '__root__'
  label: string;         // Display label: branch name or relative path
  isRoot: boolean;
  sessions: Session[];
  branchName?: string;   // From GitWorktree API
}

/**
 * Compute relative path from `from` to `to`.
 * Returns just the last segment(s) for cleaner display.
 */
function relativePath(from: string, to: string): string {
  const fromParts = from.replace(/\\/g, '/').replace(/\/$/, '').split('/');
  const toParts = to.replace(/\\/g, '/').replace(/\/$/, '').split('/');
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  return toParts.slice(i).join('/') || to;
}

/**
 * Group sessions by their workingDirectory (worktree).
 *
 * - Sessions with no workingDirectory or workingDirectory === rootPath → root group
 * - Returns empty array if only one group exists (triggers flat list fallback)
 * - Root group is always first; other groups sorted by most recent session updatedAt
 */
export function groupSessionsByWorktree(
  sessions: Session[],
  rootPath: string | undefined,
  worktrees: GitWorktree[],
): WorktreeGroup[] {
  if (sessions.length === 0) return [];

  const normalizedRoot = rootPath?.replace(/\\/g, '/').replace(/\/$/, '');

  // Build a map: worktree path → GitWorktree (for branch name lookup)
  const wtByPath = new Map<string, GitWorktree>();
  for (const wt of worktrees) {
    wtByPath.set(wt.path.replace(/\\/g, '/').replace(/\/$/, ''), wt);
  }

  // Group sessions
  const groups = new Map<string, Session[]>();

  for (const session of sessions) {
    const wd = session.workingDirectory?.replace(/\\/g, '/').replace(/\/$/, '');
    const isRoot = !wd || wd === normalizedRoot;
    const key = isRoot ? '__root__' : wd;

    const list = groups.get(key) || [];
    list.push(session);
    groups.set(key, list);
  }

  // Only show tree when there are multiple groups
  if (groups.size <= 1) return [];

  // Build WorktreeGroup objects
  const result: WorktreeGroup[] = [];

  for (const [key, groupSessions] of groups) {
    const isRoot = key === '__root__';

    // Sort sessions within group by updatedAt desc
    groupSessions.sort((a, b) => b.updatedAt - a.updatedAt);

    if (isRoot) {
      // Find the main worktree's branch name
      const mainWt = worktrees.find(wt => wt.isMain);
      result.push({
        key,
        label: mainWt?.branch || 'main',
        isRoot: true,
        sessions: groupSessions,
        branchName: mainWt?.branch,
      });
    } else {
      const wt = wtByPath.get(key);
      const label = wt?.branch || (normalizedRoot ? relativePath(normalizedRoot, key) : key);
      result.push({
        key,
        label,
        isRoot: false,
        sessions: groupSessions,
        branchName: wt?.branch,
      });
    }
  }

  // Root first, then by most recent session updatedAt desc
  result.sort((a, b) => {
    if (a.isRoot) return -1;
    if (b.isRoot) return 1;
    const aMax = Math.max(...a.sessions.map(s => s.updatedAt));
    const bMax = Math.max(...b.sessions.map(s => s.updatedAt));
    return bMax - aMax;
  });

  return result;
}
