import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import { listGitWorktrees, createGitWorktree } from '../git-worktrees';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('git-worktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listGitWorktrees', () => {
    it('应该正确解析单个 worktree', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/main`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: path.normalize('/Users/test/my-project'),
        branch: 'main',
        isMain: true,
        commit: 'abc1234',
      });
    });

    it('应该正确解析多个 worktrees', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/main

worktree /Users/test/my-project-feat
HEAD def5678
branch refs/heads/feat/new-feature`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result).toHaveLength(2);
      expect(result[0].isMain).toBe(true);
      expect(result[1].isMain).toBe(false);
      expect(result[0].branch).toBe('main');
      expect(result[1].branch).toBe('feat/new-feature');
    });

    it('应该正确处理 detached HEAD', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
detached`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result).toHaveLength(1);
      expect(result[0].branch).toBe('detached@abc1234');
    });

    it('应该正确处理分支名中的斜杠', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/feature/user-auth/login`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result[0].branch).toBe('feature/user-auth/login');
    });

    it('应该在 git 命令失败时返回空数组', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const result = listGitWorktrees('/not/a/repo');

      expect(result).toEqual([]);
    });

    it('应该在超时时返回空数组', () => {
      vi.mocked(execSync).mockImplementation(() => {
        const error = new Error('Command timeout') as any;
        error.killed = true;
        throw error;
      });

      const result = listGitWorktrees('/slow/repo');

      expect(result).toEqual([]);
    });

    it('应该正确处理空输出', () => {
      vi.mocked(execSync).mockReturnValue('');

      const result = listGitWorktrees('/repo');

      expect(result).toEqual([]);
    });

    it('应该正确处理只有空白字符的输出', () => {
      vi.mocked(execSync).mockReturnValue('   \n\n  ');

      const result = listGitWorktrees('/repo');

      expect(result).toEqual([]);
    });

    it('应该截取 commit hash 为 7 个字符', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abcdefghijklmnop
branch refs/heads/main`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result[0].commit).toBe('abcdefg');
    });

    it('应该正确处理路径规范化', () => {
      const mockOutput = `worktree /Users/test/../test/./my-project
HEAD abc1234
branch refs/heads/main`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      // path.normalize should normalize the path
      expect(result[0].path).toBe(path.normalize('/Users/test/../test/./my-project'));
    });
  });

  describe('createGitWorktree', () => {
    it('应该为新分支创建 worktree', () => {
      // Mock branch existence check (branch doesn't exist)
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        // Mock worktree creation
        .mockReturnValueOnce('');

      const result = createGitWorktree(
        '/Users/test/my-project',
        '/Users/test/my-project-feat',
        'feat/new-feature'
      );

      expect(execSync).toHaveBeenCalledTimes(2);
      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('git worktree add -b "feat/new-feature"'),
        expect.any(Object)
      );

      expect(result.branch).toBe('feat/new-feature');
      expect(result.isMain).toBe(false);
    });

    it('应该为已存在的分支创建 worktree', () => {
      // Mock branch existence check (branch exists)
      vi.mocked(execSync)
        .mockReturnValueOnce('')
        // Mock worktree creation
        .mockReturnValueOnce('');

      const result = createGitWorktree(
        '/Users/test/my-project',
        '/Users/test/my-project-feat',
        'existing-branch'
      );

      // Check that the worktree creation command doesn't include -b flag
      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.not.stringContaining('-b "existing-branch"'),
        expect.any(Object)
      );

      // Verify it's the correct command format
      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('git worktree add "/Users/test/my-project-feat" "existing-branch"'),
        expect.any(Object)
      );
    });

    it('应该正确处理相对路径', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        .mockReturnValueOnce('');

      const result = createGitWorktree(
        '/Users/test/my-project',
        '../my-project-feat',
        'feat/new-feature'
      );

      // Should resolve to absolute path
      expect(result.path).toBe(path.normalize('/Users/test/my-project-feat'));
    });

    it('应该在 worktree 创建失败时抛出错误', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        .mockImplementationOnce(() => {
          throw new Error('Worktree creation failed');
        });

      expect(() => {
        createGitWorktree(
          '/Users/test/my-project',
          '/Users/test/my-project-feat',
          'feat/new-feature'
        );
      }).toThrow('Worktree creation failed');
    });

    it('应该在分支检查超时时处理错误', () => {
      vi.mocked(execSync).mockImplementation(() => {
        const error = new Error('Command timeout') as any;
        error.killed = true;
        throw error;
      });

      // Should treat timeout as "branch doesn't exist" and proceed
      expect(() => {
        createGitWorktree(
          '/Users/test/my-project',
          '/Users/test/my-project-feat',
          'feat/new-feature'
        );
      }).toThrow();
    });

    it('应该正确处理包含特殊字符的分支名', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        .mockReturnValueOnce('');

      createGitWorktree(
        '/Users/test/my-project',
        '/Users/test/my-project-feat',
        'feat/JIRA-123_fix-bug'
      );

      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('feat/JIRA-123_fix-bug'),
        expect.any(Object)
      );
    });

    it('应该正���处理包含空格的路径', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        .mockReturnValueOnce('');

      createGitWorktree(
        '/Users/test/my project',
        '/Users/test/my project feat',
        'feat/new-feature'
      );

      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('"/Users/test/my project feat"'),
        expect.any(Object)
      );
    });
  });

  describe('边界情况', () => {
    it('应该处理非常长的分支名', () => {
      const longBranch = 'feature/'.repeat(10) + 'new-feature';
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/${longBranch}`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result[0].branch).toBe(longBranch);
    });

    it('应该处理路径中包含 Unicode 字符', () => {
      const mockOutput = `worktree /Users/测试/my-project-功能
HEAD abc1234
branch refs/heads/main`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/测试/my-project-功能');

      expect(result[0].path).toContain('测试');
      expect(result[0].path).toContain('功能');
    });

    it('应该处理多个连续的空行', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/main


worktree /Users/test/my-project-feat
HEAD def5678
branch refs/heads/feat`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result).toHaveLength(2);
    });
  });
});
