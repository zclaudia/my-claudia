import { describe, it, expect } from 'vitest';
import { groupSessionsByWorktree } from '../worktreeGrouping';
import type { Session, GitWorktree } from '@my-claudia/shared';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    projectId: 'proj-1',
    type: 'regular',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeWorktree(overrides: Partial<GitWorktree> = {}): GitWorktree {
  return {
    path: '/project',
    branch: 'main',
    isMain: true,
    ...overrides,
  };
}

describe('groupSessionsByWorktree', () => {
  it('returns empty array for empty sessions', () => {
    expect(groupSessionsByWorktree([], '/project', [])).toEqual([]);
  });

  it('returns empty array when only root group exists (flat list fallback)', () => {
    const sessions = [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2', workingDirectory: '/project' }),
    ];
    const result = groupSessionsByWorktree(sessions, '/project', []);
    expect(result).toEqual([]);
  });

  it('returns empty array when all sessions have undefined workingDirectory', () => {
    const sessions = [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2' }),
    ];
    const result = groupSessionsByWorktree(sessions, '/project', []);
    expect(result).toEqual([]);
  });

  it('groups sessions by workingDirectory when multiple groups exist', () => {
    const sessions = [
      makeSession({ id: 's1', workingDirectory: undefined }),
      makeSession({ id: 's2', workingDirectory: '/project' }),
      makeSession({ id: 's3', workingDirectory: '/project/.worktrees/supervision/slot-0' }),
    ];
    const worktrees = [
      makeWorktree({ path: '/project', branch: 'main', isMain: true }),
      makeWorktree({ path: '/project/.worktrees/supervision/slot-0', branch: 'task/fix-login/r1', isMain: false }),
    ];

    const result = groupSessionsByWorktree(sessions, '/project', worktrees);
    expect(result).toHaveLength(2);

    // Root group first
    expect(result[0].isRoot).toBe(true);
    expect(result[0].label).toBe('main');
    expect(result[0].sessions).toHaveLength(2); // s1 (undefined) + s2 (rootPath)

    // Worktree group
    expect(result[1].isRoot).toBe(false);
    expect(result[1].label).toBe('task/fix-login/r1');
    expect(result[1].branchName).toBe('task/fix-login/r1');
    expect(result[1].sessions).toHaveLength(1);
    expect(result[1].sessions[0].id).toBe('s3');
  });

  it('uses relative path as label when no GitWorktree info available', () => {
    const sessions = [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2', workingDirectory: '/project/.worktrees/supervision/slot-0' }),
    ];

    const result = groupSessionsByWorktree(sessions, '/project', []);
    expect(result).toHaveLength(2);

    // Root group has fallback label
    expect(result[0].isRoot).toBe(true);
    expect(result[0].label).toBe('main'); // default when no main worktree info

    // Worktree group uses relative path
    expect(result[1].label).toBe('.worktrees/supervision/slot-0');
  });

  it('treats workingDirectory === rootPath as root', () => {
    const sessions = [
      makeSession({ id: 's1', workingDirectory: '/project', projectRole: 'review' }),
      makeSession({ id: 's2', workingDirectory: '/project/.worktrees/supervision/slot-0', projectRole: 'task' }),
    ];

    const result = groupSessionsByWorktree(sessions, '/project', []);
    expect(result).toHaveLength(2);
    expect(result[0].isRoot).toBe(true);
    expect(result[0].sessions[0].id).toBe('s1');
  });

  it('sorts sessions within group by updatedAt desc', () => {
    const sessions = [
      makeSession({ id: 's1', updatedAt: 1000 }),
      makeSession({ id: 's2', updatedAt: 3000 }),
      makeSession({ id: 's3', workingDirectory: '/project/.worktrees/slot-0', updatedAt: 2000 }),
    ];

    const result = groupSessionsByWorktree(sessions, '/project', []);
    expect(result[0].sessions[0].id).toBe('s2'); // most recent first
    expect(result[0].sessions[1].id).toBe('s1');
  });

  it('sorts non-root groups by most recent session updatedAt desc', () => {
    const sessions = [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2', workingDirectory: '/project/.worktrees/slot-0', updatedAt: 1000 }),
      makeSession({ id: 's3', workingDirectory: '/project/.worktrees/slot-1', updatedAt: 3000 }),
    ];

    const result = groupSessionsByWorktree(sessions, '/project', []);
    expect(result).toHaveLength(3);
    expect(result[0].isRoot).toBe(true); // root always first
    expect(result[1].key).toContain('slot-1'); // slot-1 has more recent session
    expect(result[2].key).toContain('slot-0');
  });

  it('handles trailing slashes in paths', () => {
    const sessions = [
      makeSession({ id: 's1', workingDirectory: '/project/' }),
      makeSession({ id: 's2', workingDirectory: '/project/.worktrees/slot-0/' }),
    ];

    const result = groupSessionsByWorktree(sessions, '/project/', []);
    expect(result).toHaveLength(2);
    expect(result[0].isRoot).toBe(true);
    expect(result[0].sessions).toHaveLength(1);
  });

  it('uses main worktree branch name for root label', () => {
    const sessions = [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2', workingDirectory: '/project/.worktrees/slot-0' }),
    ];
    const worktrees = [
      makeWorktree({ path: '/project', branch: 'develop', isMain: true }),
    ];

    const result = groupSessionsByWorktree(sessions, '/project', worktrees);
    expect(result[0].label).toBe('develop');
    expect(result[0].branchName).toBe('develop');
  });

  it('handles multiple worktree groups', () => {
    const sessions = [
      makeSession({ id: 's1' }),
      makeSession({ id: 's2', workingDirectory: '/project/.worktrees/supervision/slot-0', projectRole: 'task' }),
      makeSession({ id: 's3', workingDirectory: '/project/.worktrees/supervision/slot-1', projectRole: 'task' }),
      makeSession({ id: 's4', workingDirectory: '/project/.worktrees/supervision/slot-0', projectRole: 'task' }),
    ];

    const result = groupSessionsByWorktree(sessions, '/project', []);
    expect(result).toHaveLength(3); // root + slot-0 + slot-1
    // slot-0 has 2 sessions, slot-1 has 1
    const slot0 = result.find(g => g.key.includes('slot-0'));
    expect(slot0?.sessions).toHaveLength(2);
  });
});
