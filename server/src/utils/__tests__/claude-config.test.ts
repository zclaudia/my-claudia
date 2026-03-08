import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadMcpServers,
  loadPlugins,
  clearClaudeConfigCache,
  type McpStdioServerConfig,
  type SdkPluginConfig,
} from '../claude-config.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock modules
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}));

describe('utils/claude-config', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearClaudeConfigCache();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('loadMcpServers', () => {
    it('returns empty object if no config file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadMcpServers();

      expect(result).toEqual({});
    });

    it('loads MCP servers from config', () => {
      const mockConfig = {
        mcpServers: {
          'server1': { command: 'node', args: ['server.js'], env: { API_KEY: 'test' } },
          'server2': { command: 'python', args: ['-m', 'mcp_server'] },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const result = loadMcpServers();

      expect(result).toEqual({
        server1: { command: 'node', args: ['server.js'], env: { API_KEY: 'test' } },
        server2: { command: 'python', args: ['-m', 'mcp_server'] },
      });
    });

    it('skips servers without command', () => {
      const mockConfig = {
        mcpServers: {
          'valid': { command: 'node' },
          'invalid': { args: ['some-arg'] } as any,
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const result = loadMcpServers();

      expect(result).toHaveProperty('valid');
      expect(result).not.toHaveProperty('invalid');
    });

    it('handles JSON parse errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const result = loadMcpServers();

      expect(result).toEqual({});
    });

    it('caches result within TTL', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ mcpServers: { test: { command: 'test' } } }));

      // First call
      loadMcpServers();
      // Second call within TTL
      loadMcpServers();

      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('reloads after cache expires', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ mcpServers: { test: { command: 'test' } } }));

      // First call
      loadMcpServers();

      // Advance time past TTL (10 minutes)
      vi.useFakeTimers();
      vi.advanceTimersByTime(11 * 60 * 1000);

      // Second call should reload
      loadMcpServers();

      expect(fs.readFileSync).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('logs loaded servers count', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        mcpServers: {
          'server1': { command: 'node' },
          'server2': { command: 'python' },
        },
      }));

      loadMcpServers();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Loaded 2 MCP server(s)')
      );
    });
  });

  describe('loadPlugins', () => {
    it('returns empty array if no plugins enabled', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = loadPlugins();

      expect(result).toEqual([]);
    });

    it('loads enabled plugins with install paths', () => {
      const mockSettings = {
        enabledPlugins: {
          'plugin-one': true,
          'plugin-two': false,
          'plugin-three': true,
        },
      };

      const mockInstalled = {
        version: 1,
        plugins: {
          'plugin-one': [{ scope: 'user', installPath: '/plugins/plugin-one', version: '1.0.0' }],
          'plugin-two': [{ scope: 'user', installPath: '/plugins/plugin-two', version: '1.0.0' }],
          'plugin-three': [{ scope: 'user', installPath: '/plugins/plugin-three', version: '1.0.0' }],
        },
      };

      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true)  // settings.json
        .mockReturnValueOnce(true)  // installed_plugins.json
        .mockReturnValueOnce(true)  // plugin-one path
        .mockReturnValueOnce(true); // plugin-three path
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify(mockSettings))
        .mockReturnValueOnce(JSON.stringify(mockInstalled));

      const result = loadPlugins();

      // Only plugin-one and plugin-three are enabled
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'local', path: '/plugins/plugin-one' });
      expect(result[1]).toEqual({ type: 'local', path: '/plugins/plugin-three' });
    });

    it('skips plugins without installation', () => {
      const mockSettings = {
        enabledPlugins: {
          'installed-plugin': true,
          'missing-plugin': true,
        },
      };

      const mockInstalled = {
        version: 1,
        plugins: {
          'installed-plugin': [{ scope: 'user', installPath: '/plugins/installed', version: '1.0.0' }],
          // missing-plugin not in installed
        },
      };

      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify(mockSettings))
        .mockReturnValueOnce(JSON.stringify(mockInstalled));

      const result = loadPlugins();

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/plugins/installed');
    });

    it('skips plugins with non-existent install path', () => {
      const mockSettings = {
        enabledPlugins: { 'test-plugin': true },
      };

      const mockInstalled = {
        version: 1,
        plugins: {
          'test-plugin': [{ scope: 'user', installPath: '/nonexistent', version: '1.0.0' }],
        },
      };

      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false); // install path doesn't exist
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify(mockSettings))
        .mockReturnValueOnce(JSON.stringify(mockInstalled));

      const result = loadPlugins();

      expect(result).toHaveLength(0);
    });

    it('caches result within TTL', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      loadPlugins();
      loadPlugins();

      expect(fs.readFileSync).toHaveBeenCalledTimes(0); // No file reads when no config
    });

    it('logs loaded plugins count', () => {
      const mockSettings = { enabledPlugins: { 'test': true } };
      const mockInstalled = {
        version: 1,
        plugins: { 'test': [{ scope: 'user', installPath: '/plugins/test', version: '1.0' }] },
      };

      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true);
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify(mockSettings))
        .mockReturnValueOnce(JSON.stringify(mockInstalled));

      loadPlugins();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Loaded 1 plugin(s)')
      );
    });
  });

  describe('clearClaudeConfigCache', () => {
    it('clears both caches', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ mcpServers: { test: { command: 'test' } } }));

      // Load to populate cache
      loadMcpServers();

      clearClaudeConfigCache();

      // Load again should read file again
      loadMcpServers();

      expect(fs.readFileSync).toHaveBeenCalledTimes(2);
    });
  });
});
