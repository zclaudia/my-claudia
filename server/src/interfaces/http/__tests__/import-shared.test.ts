import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expandTilde, checkDuplicateSession } from '../import-shared.js';
import * as os from 'os';
import * as path from 'path';

// Mock os and path modules
vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
}));

describe('routes/import-shared', () => {
  describe('expandTilde', () => {
    it('expands ~/ to home directory', () => {
      const result = expandTilde('~/Documents/project');

      expect(os.homedir).toHaveBeenCalled();
      expect(result).toBe('/home/testuser/Documents/project');
    });

    it('expands ~ alone to home directory', () => {
      const result = expandTilde('~');

      expect(os.homedir).toHaveBeenCalled();
      expect(result).toBe('/home/testuser');
    });

    it('returns unchanged path without tilde', () => {
      const result = expandTilde('/absolute/path/to/file');

      expect(result).toBe('/absolute/path/to/file');
    });

    it('handles relative paths without tilde', () => {
      const result = expandTilde('relative/path');

      expect(result).toBe('relative/path');
    });

    it('handles empty string', () => {
      const result = expandTilde('');

      expect(result).toBe('');
    });

    it('does not expand ~ in middle of path', () => {
      const result = expandTilde('/path/~user/file');

      expect(result).toBe('/path/~user/file');
    });

    it('handles ~ followed by non-slash', () => {
      const result = expandTilde('~username');

      expect(result).toBe('~username');
    });
  });

  describe('checkDuplicateSession', () => {
    let mockDb: any;

    beforeEach(() => {
      mockDb = {
        prepare: vi.fn().mockReturnValue({
          get: vi.fn(),
        }),
      };
    });

    it('returns "not_exists" when session not found', () => {
      mockDb.prepare().get.mockReturnValue(undefined);

      const result = checkDuplicateSession(mockDb, 'session-123', 'project-1');

      expect(result).toBe('not_exists');
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT project_id FROM sessions'));
    });

    it('returns "exists" when session exists in same project', () => {
      mockDb.prepare().get.mockReturnValue({ project_id: 'project-1' });

      const result = checkDuplicateSession(mockDb, 'session-123', 'project-1');

      expect(result).toBe('exists');
    });

    it('returns "different_project" when session exists in different project', () => {
      mockDb.prepare().get.mockReturnValue({ project_id: 'project-2' });

      const result = checkDuplicateSession(mockDb, 'session-123', 'project-1');

      expect(result).toBe('different_project');
    });

    it('handles project_id as null', () => {
      mockDb.prepare().get.mockReturnValue({ project_id: null });

      const result = checkDuplicateSession(mockDb, 'session-123', 'project-1');

      expect(result).toBe('different_project');
    });

    it('handles project_id as empty string', () => {
      mockDb.prepare().get.mockReturnValue({ project_id: '' });

      const result = checkDuplicateSession(mockDb, 'session-123', '');

      expect(result).toBe('exists');
    });
  });
});
