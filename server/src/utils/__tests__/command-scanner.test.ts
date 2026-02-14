import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { scanCustomCommands, getGlobalCommandsDir, getProjectCommandsDir } from '../command-scanner.js';

// Mock the fs module
vi.mock('fs');
vi.mock('os');

describe('command-scanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default homedir mock
    vi.mocked(os.homedir).mockReturnValue('/home/testuser');
  });

  describe('getGlobalCommandsDir', () => {
    it('returns the correct global commands directory path', () => {
      const result = getGlobalCommandsDir();
      expect(result).toBe('/home/testuser/.claude/commands');
    });
  });

  describe('getProjectCommandsDir', () => {
    it('returns the correct project commands directory path', () => {
      const result = getProjectCommandsDir('/projects/my-project');
      expect(result).toBe('/projects/my-project/.claude/commands');
    });
  });

  describe('scanCustomCommands', () => {
    it('returns empty array when directories do not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = scanCustomCommands();
      expect(result).toEqual([]);
    });

    it('scans global commands directory', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === '/home/testuser/.claude/commands';
      });
      vi.mocked(fs.readdirSync).mockReturnValue(['review.md', 'fix.md'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue('# Review code\nThis is a review command');

      const result = scanCustomCommands();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        command: '/review',
        description: 'Review code',
        source: 'custom',
        scope: 'global',
        filePath: '/home/testuser/.claude/commands/review.md',
      });
      expect(result[1]).toEqual({
        command: '/fix',
        description: 'Review code',
        source: 'custom',
        scope: 'global',
        filePath: '/home/testuser/.claude/commands/fix.md',
      });
    });

    it('scans project commands when projectRoot is provided', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === '/projects/my-project/.claude/commands';
      });
      vi.mocked(fs.readdirSync).mockReturnValue(['deploy.md'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue('# Deploy project\nDeploy to production');

      const result = scanCustomCommands({ projectRoot: '/projects/my-project' });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        command: '/deploy',
        description: 'Deploy project',
        source: 'custom',
        scope: 'project',
        filePath: '/projects/my-project/.claude/commands/deploy.md',
      });
    });

    it('skips non-md files', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['review.md', 'readme.txt', 'config.json'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue('# Review\nContent');

      const result = scanCustomCommands();

      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/review');
    });

    it('skips directories', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['review.md', 'subdir'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('subdir')) {
          return { isFile: () => false } as fs.Stats;
        }
        return { isFile: () => true } as fs.Stats;
      });
      vi.mocked(fs.readFileSync).mockReturnValue('# Review\nContent');

      const result = scanCustomCommands();

      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/review');
    });

    it('uses default description when content is empty', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['empty.md'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue('');

      const result = scanCustomCommands();

      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('Custom command');
    });

    it('extracts description from YAML frontmatter', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['test.md'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(`---
description: Custom review command for code
title: Review
---
# Content`);

      const result = scanCustomCommands();

      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('Custom review command for code');
    });

    it('truncates long descriptions from frontmatter', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['test.md'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      const longDesc = 'A'.repeat(100);
      vi.mocked(fs.readFileSync).mockReturnValue(`---
description: ${longDesc}
---
Content`);

      const result = scanCustomCommands();

      expect(result).toHaveLength(1);
      expect(result[0].description).toHaveLength(80);
      expect(result[0].description.endsWith('...')).toBe(true);
    });

    it('extracts description from first heading when no frontmatter', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['test.md'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(`# My Custom Command
Some content here`);

      const result = scanCustomCommands();

      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('My Custom Command');
    });

    it('extracts description from first non-empty line as fallback', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['test.md'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockReturnValue(`

This is the first non-empty line
More content`);

      const result = scanCustomCommands();

      expect(result).toHaveLength(1);
      expect(result[0].description).toBe('This is the first non-empty line');
    });

    it('does not scan plugins when includePlugins is false', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('installed_plugins.json')) {
          return true;
        }
        return path === '/home/testuser/.claude/commands';
      });
      vi.mocked(fs.readdirSync).mockReturnValue(['review.md'] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('installed_plugins.json')) {
          return JSON.stringify({
            version: 1,
            plugins: {
              'test-plugin@marketplace': [{ installPath: '/plugins/test' }]
            }
          });
        }
        return '# Review\nContent';
      });

      const result = scanCustomCommands({ includePlugins: false });

      // Should only have the global command, no plugin commands
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/review');
    });

    it('scans plugin commands when plugins are installed', () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('installed_plugins.json')) return true;
          if (path === '/plugins/test-plugin') return true;
          if (path === '/plugins/test-plugin/commands') return true;
        }
        return false;
      });
      vi.mocked(fs.readdirSync).mockImplementation((path) => {
        if (typeof path === 'string' && path.includes('/commands')) {
          return ['plugin-cmd.md'] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
      });
      vi.mocked(fs.statSync).mockReturnValue({ isFile: () => true } as fs.Stats);
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        if (typeof path === 'string') {
          if (path.includes('installed_plugins.json')) {
            return JSON.stringify({
              version: 1,
              plugins: {
                'test-plugin@marketplace': [{
                  scope: 'user',
                  installPath: '/plugins/test-plugin',
                  version: '1.0.0',
                  installedAt: '2024-01-01',
                  lastUpdated: '2024-01-01'
                }]
              }
            });
          }
          if (path.includes('plugin-cmd.md')) {
            return '# Plugin Command\nDescription';
          }
        }
        return '';
      });

      const result = scanCustomCommands();

      expect(result.some(cmd => cmd.command === '/test-plugin:plugin-cmd')).toBe(true);
      expect(result.find(cmd => cmd.command === '/test-plugin:plugin-cmd')?.source).toBe('plugin');
    });
  });
});
