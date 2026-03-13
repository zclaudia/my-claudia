import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const mockExecSync = vi.fn();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock fs so findInCommonPaths doesn't discover real CLI tools on the machine
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => ({ isFile: () => false })),
  default: { existsSync: vi.fn(() => false), statSync: vi.fn(() => ({ isFile: () => false })) },
}));

// Helper to create a mock child process for spawn
function createMockProcess(stdout: string, exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  setTimeout(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    proc.emit('close', exitCode);
  }, 0);
  return proc;
}

// Helper to create a mock process that emits an error
function createErrorProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  setTimeout(() => {
    proc.emit('error', new Error('spawn failed'));
  }, 0);
  return proc;
}

import { detectCliProviders, detectCliProvidersSync } from '../cli-detect.js';

describe('cli-detect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectCliProviders', () => {
    it('detects claude when which claude returns a path', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '/usr/local/bin/claude\n';
        throw new Error('not found');
      });
      mockSpawn.mockImplementation(() => createMockProcess('1.0.5'));

      const result = await detectCliProviders();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'claude',
        name: 'Claude Code',
        cliPath: '/usr/local/bin/claude',
        version: '1.0.5',
      });
    });

    it('detects opencode when which opencode returns a path', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('opencode')) return '/usr/bin/opencode\n';
        throw new Error('not found');
      });
      mockSpawn.mockImplementation(() => createMockProcess('0.2.1'));

      const result = await detectCliProviders();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'opencode',
        name: 'OpenCode',
        cliPath: '/usr/bin/opencode',
        version: '0.2.1',
      });
    });

    it('detects both if both are available', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '/usr/local/bin/claude\n';
        if (cmd.includes('opencode')) return '/usr/bin/opencode\n';
        throw new Error('not found');
      });
      mockSpawn.mockImplementation((cliPath: string) => {
        if (cliPath.includes('claude')) return createMockProcess('1.0.5');
        if (cliPath.includes('opencode')) return createMockProcess('0.2.1');
        return createMockProcess('');
      });

      const result = await detectCliProviders();

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('claude');
      expect(result[0].cliPath).toBe('/usr/local/bin/claude');
      expect(result[0].version).toBe('1.0.5');
      expect(result[1].type).toBe('opencode');
      expect(result[1].cliPath).toBe('/usr/bin/opencode');
      expect(result[1].version).toBe('0.2.1');
    });

    it('returns empty array when no CLI found', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await detectCliProviders();

      expect(result).toEqual([]);
    });

    it('uses first matching command (claude before claude-code)', async () => {
      // Both claude and claude-code exist, but only the first should be used
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('claude-code')) return '/usr/local/bin/claude-code\n';
        if (cmd.includes('claude')) return '/usr/local/bin/claude\n';
        throw new Error('not found');
      });
      mockSpawn.mockImplementation(() => createMockProcess('1.0.5'));

      const result = await detectCliProviders();

      expect(result).toHaveLength(1);
      expect(result[0].cliPath).toBe('/usr/local/bin/claude');
      // Verify spawn was called with the first match, not claude-code
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        ['--version'],
        expect.objectContaining({ timeout: 5000, shell: true })
      );
    });

    it('includes version from --version output', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '/usr/local/bin/claude\n';
        throw new Error('not found');
      });
      mockSpawn.mockImplementation(() => createMockProcess('claude v2.3.4\n'));

      const result = await detectCliProviders();

      expect(result).toHaveLength(1);
      expect(result[0].version).toBe('claude v2.3.4');
    });

    it('handles version command failure gracefully (version = undefined)', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '/usr/local/bin/claude\n';
        throw new Error('not found');
      });
      mockSpawn.mockImplementation(() => createErrorProcess());

      const result = await detectCliProviders();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'claude',
        name: 'Claude Code',
        cliPath: '/usr/local/bin/claude',
        version: undefined,
      });
    });
  });

  describe('detectCliProvidersSync', () => {
    it('detects claude sync (no version)', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '/usr/local/bin/claude\n';
        throw new Error('not found');
      });

      const result = detectCliProvidersSync();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'claude',
        name: 'Claude Code',
        cliPath: '/usr/local/bin/claude',
        version: undefined,
      });
    });

    it('detects opencode sync (no version)', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('opencode')) return '/usr/bin/opencode\n';
        throw new Error('not found');
      });

      const result = detectCliProvidersSync();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'opencode',
        name: 'OpenCode',
        cliPath: '/usr/bin/opencode',
        version: undefined,
      });
    });

    it('returns empty array when no CLI found', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = detectCliProvidersSync();

      expect(result).toEqual([]);
    });
  });

  describe('findInPath behavior', () => {
    it('handles execSync throwing (command not found)', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await detectCliProviders();

      expect(result).toEqual([]);
    });

    it('takes first line of multi-line output', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '/usr/local/bin/claude\n/usr/bin/claude\n';
        throw new Error('not found');
      });
      mockSpawn.mockImplementation(() => createMockProcess('1.0.0'));

      const result = await detectCliProviders();

      expect(result).toHaveLength(1);
      expect(result[0].cliPath).toBe('/usr/local/bin/claude');
    });

    it('handles empty output', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('claude')) return '   \n';
        throw new Error('not found');
      });

      const result = await detectCliProviders();

      // Empty/whitespace-only output after trim should not register as found
      expect(result).toEqual([]);
    });
  });
});
