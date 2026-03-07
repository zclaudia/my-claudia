/**
 * Unit tests for CommandRegistry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commandRegistry, registerCommand } from '../registry';

describe('CommandRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    commandRegistry.clear();
  });

  describe('register', () => {
    it('should register a command', () => {
      commandRegistry.register({
        command: '/test',
        description: 'A test command',
        handler: async () => ({ type: 'builtin', command: '/test', data: {} }),
        source: 'builtin',
      });

      expect(commandRegistry.has('/test')).toBe(true);
      expect(commandRegistry.size).toBe(1);
    });

    it('should warn when overwriting an existing command', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      commandRegistry.register({
        command: '/test',
        description: 'First',
        handler: async () => ({ type: 'builtin', command: '/test', data: {} }),
        source: 'builtin',
      });

      commandRegistry.register({
        command: '/test',
        description: 'Second',
        handler: async () => ({ type: 'builtin', command: '/test', data: {} }),
        source: 'plugin',
        pluginId: 'com.example.plugin',
      });

      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain('already registered');
      expect(warnSpy.mock.calls[0][0]).toContain('Overwriting');

      warnSpy.mockRestore();
    });
  });

  describe('unregister', () => {
    it('should unregister a command', () => {
      commandRegistry.register({
        command: '/test',
        description: 'Test',
        handler: async () => ({ type: 'builtin', command: '/test', data: {} }),
        source: 'builtin',
      });

      expect(commandRegistry.unregister('/test')).toBe(true);
      expect(commandRegistry.has('/test')).toBe(false);
    });

    it('should return false when unregistering non-existent command', () => {
      expect(commandRegistry.unregister('/nonexistent')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return command metadata', () => {
      commandRegistry.register({
        command: '/test',
        description: 'Test command',
        handler: async () => ({ type: 'builtin', command: '/test', data: {} }),
        source: 'plugin',
        pluginId: 'com.example.plugin',
        permissions: ['fs.read'],
      });

      const meta = commandRegistry.get('/test');
      expect(meta).toBeDefined();
      expect(meta?.command).toBe('/test');
      expect(meta?.description).toBe('Test command');
      expect(meta?.source).toBe('plugin');
      expect(meta?.pluginId).toBe('com.example.plugin');
      expect(meta?.permissions).toContain('fs.read');
    });

    it('should return undefined for non-existent command', () => {
      expect(commandRegistry.get('/nonexistent')).toBeUndefined();
    });
  });

  describe('getAllCommands', () => {
    it('should return all commands as SlashCommand array', () => {
      commandRegistry.register({
        command: '/cmd1',
        description: 'Command 1',
        handler: async () => ({ type: 'builtin', command: '/cmd1', data: {} }),
        source: 'builtin',
      });

      commandRegistry.register({
        command: '/cmd2',
        description: 'Command 2',
        handler: async () => ({ type: 'builtin', command: '/cmd2', data: {} }),
        source: 'plugin',
        pluginId: 'com.example.plugin',
      });

      const commands = commandRegistry.getAllCommands();
      expect(commands).toHaveLength(2);
      expect(commands.map((c) => c.command)).toContain('/cmd1');
      expect(commands.map((c) => c.command)).toContain('/cmd2');
    });
  });

  describe('getCommandsBySource', () => {
    it('should filter commands by source', () => {
      commandRegistry.register({
        command: '/builtin_cmd',
        description: 'Builtin',
        handler: async () => ({ type: 'builtin', command: '/builtin_cmd', data: {} }),
        source: 'builtin',
      });

      commandRegistry.register({
        command: '/plugin_cmd',
        description: 'Plugin',
        handler: async () => ({ type: 'builtin', command: '/plugin_cmd', data: {} }),
        source: 'plugin',
        pluginId: 'com.example.plugin',
      });

      const builtin = commandRegistry.getCommandsBySource('builtin');
      expect(builtin).toHaveLength(1);
      expect(builtin[0].command).toBe('/builtin_cmd');

      const plugin = commandRegistry.getCommandsBySource('plugin');
      expect(plugin).toHaveLength(1);
      expect(plugin[0].command).toBe('/plugin_cmd');
    });
  });

  describe('execute', () => {
    it('should execute a command and return result', async () => {
      commandRegistry.register({
        command: '/echo',
        description: 'Echo command',
        handler: async (args) => ({
          type: 'builtin',
          command: '/echo',
          data: { echoed: args.join(' ') },
        }),
        source: 'builtin',
      });

      const result = await commandRegistry.execute('/echo', ['hello', 'world']);
      expect(result.type).toBe('builtin');
      expect(result.command).toBe('/echo');
      expect(result.data).toEqual({ echoed: 'hello world' });
    });

    it('should return error for unknown command', async () => {
      const result = await commandRegistry.execute('/unknown');
      expect(result.error).toContain('Unknown command');
    });

    it('should handle handler errors', async () => {
      commandRegistry.register({
        command: '/failing',
        description: 'Fails',
        handler: async () => {
          throw new Error('Handler failed');
        },
        source: 'builtin',
      });

      const result = await commandRegistry.execute('/failing');
      expect(result.error).toContain('Command execution failed');
      expect(result.error).toContain('Handler failed');
    });

    it('should pass context to handler', async () => {
      commandRegistry.register({
        command: '/context-test',
        description: 'Test context',
        handler: async (_args, context) => ({
          type: 'builtin',
          command: '/context-test',
          data: {
            projectPath: context?.projectPath,
            model: context?.model,
          },
        }),
        source: 'builtin',
      });

      const result = await commandRegistry.execute('/context-test', [], {
        projectPath: '/test/path',
        model: 'claude-3',
      });

      expect(result.data).toEqual({
        projectPath: '/test/path',
        model: 'claude-3',
      });
    });

    it('should support sync handlers', async () => {
      commandRegistry.register({
        command: '/sync',
        description: 'Sync handler',
        handler: () => ({
          type: 'builtin',
          command: '/sync',
          data: { sync: true },
        }),
        source: 'builtin',
      });

      const result = await commandRegistry.execute('/sync');
      expect(result.data).toEqual({ sync: true });
    });
  });

  describe('clearByPlugin', () => {
    it('should clear all commands from a specific plugin', () => {
      commandRegistry.register({
        command: '/plugin1_cmd1',
        description: 'P1C1',
        handler: async () => ({ type: 'builtin', command: '/plugin1_cmd1', data: {} }),
        source: 'plugin',
        pluginId: 'com.plugin1',
      });

      commandRegistry.register({
        command: '/plugin1_cmd2',
        description: 'P1C2',
        handler: async () => ({ type: 'builtin', command: '/plugin1_cmd2', data: {} }),
        source: 'plugin',
        pluginId: 'com.plugin1',
      });

      commandRegistry.register({
        command: '/plugin2_cmd',
        description: 'P2C',
        handler: async () => ({ type: 'builtin', command: '/plugin2_cmd', data: {} }),
        source: 'plugin',
        pluginId: 'com.plugin2',
      });

      const count = commandRegistry.clearByPlugin('com.plugin1');
      expect(count).toBe(2);
      expect(commandRegistry.size).toBe(1);
      expect(commandRegistry.has('/plugin2_cmd')).toBe(true);
    });
  });

  describe('getByPlugin', () => {
    it('should get all commands from a specific plugin', () => {
      commandRegistry.register({
        command: '/cmd1',
        description: 'C1',
        handler: async () => ({ type: 'builtin', command: '/cmd1', data: {} }),
        source: 'plugin',
        pluginId: 'com.example.plugin',
      });

      commandRegistry.register({
        command: '/cmd2',
        description: 'C2',
        handler: async () => ({ type: 'builtin', command: '/cmd2', data: {} }),
        source: 'builtin',
      });

      const pluginCommands = commandRegistry.getByPlugin('com.example.plugin');
      expect(pluginCommands).toHaveLength(1);
      expect(pluginCommands[0].command).toBe('/cmd1');
    });
  });
});

describe('registerCommand helper', () => {
  beforeEach(() => {
    commandRegistry.clear();
  });

  it('should register a command with simpler API', () => {
    registerCommand(
      {
        command: '/simple',
        description: 'A simple command',
        handler: async (args) => ({
          type: 'builtin',
          command: '/simple',
          data: { args },
        }),
      },
      'plugin',
      'com.example.plugin'
    );

    expect(commandRegistry.has('/simple')).toBe(true);
    const meta = commandRegistry.get('/simple');
    expect(meta?.source).toBe('plugin');
    expect(meta?.pluginId).toBe('com.example.plugin');
  });

  it('should default to plugin source', () => {
    registerCommand({
      command: '/default',
      description: 'Default source',
      handler: async () => ({ type: 'builtin', command: '/default', data: {} }),
    });

    const meta = commandRegistry.get('/default');
    expect(meta?.source).toBe('plugin');
  });
});
