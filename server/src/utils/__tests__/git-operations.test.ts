import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import {
  getGitStatus,
  isWorkingTreeClean,
  commitAllChanges,
  getNewCommits,
  getDiff,
  getMainBranch,
  getCurrentBranch,
  mergeBranch,
  abortMerge,
  removeWorktree,
} from '../git-operations.js';

function mockGitSuccess(stdout: string) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    cb(null, { stdout });
  });
}

function mockGitSequence(outputs: (string | Error)[]) {
  let i = 0;
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    const output = outputs[i++] ?? '';
    if (output instanceof Error) {
      cb(output, { stdout: '', stderr: '' });
    } else {
      cb(null, { stdout: output });
    }
  });
}

function mockGitError(err: Error & { stderr?: string; stdout?: string }) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
    cb(err, { stdout: err.stdout || '', stderr: err.stderr || '' });
  });
}

describe('git-operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('getGitStatus', () => {
    it('returns empty status for clean repo', async () => {
      mockGitSuccess('');
      const status = await getGitStatus('/repo');
      expect(status.hasChanges).toBe(false);
      expect(status.staged).toEqual([]);
      expect(status.unstaged).toEqual([]);
      expect(status.untracked).toEqual([]);
    });

    it('parses staged files', async () => {
      mockGitSuccess('M  file.ts\nA  new.ts\n');
      const status = await getGitStatus('/repo');
      expect(status.staged).toEqual(['file.ts', 'new.ts']);
      expect(status.hasChanges).toBe(true);
    });

    it('parses unstaged files', async () => {
      mockGitSuccess(' M file.ts\n');
      const status = await getGitStatus('/repo');
      expect(status.unstaged).toEqual(['file.ts']);
    });

    it('parses untracked files', async () => {
      mockGitSuccess('?? newfile.ts\n');
      const status = await getGitStatus('/repo');
      expect(status.untracked).toEqual(['newfile.ts']);
    });

    it('parses mixed status', async () => {
      mockGitSuccess('M  staged.ts\n M unstaged.ts\n?? untracked.ts\n');
      const status = await getGitStatus('/repo');
      expect(status.staged).toEqual(['staged.ts']);
      expect(status.unstaged).toEqual(['unstaged.ts']);
      expect(status.untracked).toEqual(['untracked.ts']);
    });
  });

  describe('isWorkingTreeClean', () => {
    it('returns true for clean tree', async () => {
      mockGitSuccess('');
      expect(await isWorkingTreeClean('/repo')).toBe(true);
    });

    it('returns false when staged changes exist', async () => {
      mockGitSuccess('M  file.ts\n');
      expect(await isWorkingTreeClean('/repo')).toBe(false);
    });

    it('returns true with only untracked files', async () => {
      mockGitSuccess('?? newfile.ts\n');
      expect(await isWorkingTreeClean('/repo')).toBe(true);
    });
  });

  describe('commitAllChanges', () => {
    it('commits and returns SHA', async () => {
      mockGitSequence([
        '',                           // git add -A
        ' file.ts | 5 ++---\n 1 file changed, 2 insertions(+), 3 deletions(-)\n', // git diff --cached --stat
        '',                           // git commit
        'abc123\n',                   // git rev-parse HEAD
      ]);
      const sha = await commitAllChanges('/repo');
      expect(sha).toBe('abc123');
    });

    it('generates message for single file', async () => {
      mockGitSequence([
        '',                                   // git add -A
        ' src/index.ts | 5 ++---\n 1 file changed\n', // git diff --cached --stat
        '',                                   // git commit
        'abc123\n',                           // rev-parse
      ]);
      await commitAllChanges('/repo');
      // Check commit message contains filename
      const commitCall = mockExecFile.mock.calls[2];
      expect(commitCall[1]).toContain('chore: update src/index.ts');
    });

    it('generates message for multiple files', async () => {
      mockGitSequence([
        '',
        ' a.ts | 1 +\n b.ts | 2 ++\n 2 files changed\n',
        '',
        'def456\n',
      ]);
      await commitAllChanges('/repo');
      const commitCall = mockExecFile.mock.calls[2];
      const msg = commitCall[1][commitCall[1].indexOf('-m') + 1];
      expect(msg).toContain('+1 files');
    });

    it('uses fallback message on diff error', async () => {
      mockGitSequence([
        '',                      // git add
        new Error('diff error'), // git diff fails
        '',                      // git commit
        'abc\n',                 // rev-parse
      ]);
      await commitAllChanges('/repo');
      const commitCall = mockExecFile.mock.calls[2];
      expect(commitCall[1]).toContain('chore: auto-commit before PR');
    });
  });

  describe('getNewCommits', () => {
    it('parses commit log', async () => {
      const SEP = '\x1f';
      mockGitSuccess(`abc123${SEP}fix bug${SEP}Author${SEP}1700000000\ndef456${SEP}add feature${SEP}Dev${SEP}1700001000\n`);
      const commits = await getNewCommits('/repo', 'feature', 'main');
      expect(commits).toHaveLength(2);
      expect(commits[0].sha).toBe('abc123');
      expect(commits[0].message).toBe('fix bug');
      expect(commits[0].date).toBe(1700000000000);
    });

    it('returns empty for no new commits', async () => {
      mockGitSuccess('');
      const commits = await getNewCommits('/repo', 'feature', 'main');
      expect(commits).toEqual([]);
    });
  });

  describe('getDiff', () => {
    it('returns full diff when under limit', async () => {
      mockGitSuccess('diff content here');
      const diff = await getDiff('/repo', 'main', 'feature');
      expect(diff).toBe('diff content here');
    });

    it('truncates diff when over limit', async () => {
      const largeDiff = 'x'.repeat(200);
      mockGitSuccess(largeDiff);
      const diff = await getDiff('/repo', 'main', 'feature', 100);
      expect(diff.length).toBeLessThan(largeDiff.length);
      expect(diff).toContain('[diff truncated]');
    });
  });

  describe('getMainBranch', () => {
    it('returns branch from origin/HEAD', async () => {
      mockGitSuccess('origin/main\n');
      const branch = await getMainBranch('/repo');
      expect(branch).toBe('main');
    });

    it('falls back to local branches when origin/HEAD fails', async () => {
      mockGitSequence([
        new Error('no origin'),  // rev-parse fails
        '* main\n',             // branch --list
      ]);
      const branch = await getMainBranch('/repo');
      expect(branch).toBe('main');
    });

    it('returns master when main not found', async () => {
      mockGitSequence([
        new Error('no origin'),
        '* master\n',
      ]);
      const branch = await getMainBranch('/repo');
      expect(branch).toBe('master');
    });

    it('defaults to master when everything fails', async () => {
      mockGitSequence([
        new Error('no origin'),
        new Error('no branches'),
      ]);
      const branch = await getMainBranch('/repo');
      expect(branch).toBe('master');
    });
  });

  describe('getCurrentBranch', () => {
    it('returns current branch name', async () => {
      mockGitSuccess('feature-branch\n');
      const branch = await getCurrentBranch('/repo');
      expect(branch).toBe('feature-branch');
    });
  });

  describe('mergeBranch', () => {
    it('returns success on clean merge', async () => {
      mockGitSuccess('');
      const result = await mergeBranch('/repo', 'feature');
      expect(result.success).toBe(true);
    });

    it('returns conflicts on merge failure', async () => {
      const err = new Error('merge conflict') as Error & { stderr: string };
      err.stderr = 'CONFLICT (content): Merge conflict in file.ts\n';
      mockGitSequence([err, '']); // merge fails, abort succeeds
      const result = await mergeBranch('/repo', 'feature');
      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts![0]).toContain('CONFLICT');
    });

    it('uses custom merge message', async () => {
      mockGitSuccess('');
      await mergeBranch('/repo', 'feature', 'Custom merge msg');
      const args = mockExecFile.mock.calls[0][1];
      expect(args).toContain('Custom merge msg');
    });
  });

  describe('abortMerge', () => {
    it('runs merge --abort', async () => {
      mockGitSuccess('');
      await abortMerge('/repo');
      expect(mockExecFile).toHaveBeenCalled();
    });

    it('does not throw on error', async () => {
      mockGitError(new Error('no merge'));
      await expect(abortMerge('/repo')).resolves.not.toThrow();
    });
  });

  describe('removeWorktree', () => {
    it('removes worktree', async () => {
      mockGitSuccess('');
      await removeWorktree('/main', '/worktree');
      expect(mockExecFile).toHaveBeenCalled();
    });

    it('removes worktree and deletes branch', async () => {
      mockGitSequence(['', '']); // worktree remove, branch -D
      await removeWorktree('/main', '/worktree', 'feature');
      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });

    it('handles worktree remove failure gracefully', async () => {
      mockGitSequence([new Error('not a worktree'), '']);
      await expect(removeWorktree('/main', '/worktree', 'branch')).resolves.not.toThrow();
    });
  });
});
