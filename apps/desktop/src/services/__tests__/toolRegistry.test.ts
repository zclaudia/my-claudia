/**
 * Unit tests for ToolRegistry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry, registerTool } from '../toolRegistry';
import type { ToolCall } from '../clientAI';

describe('ToolRegistry', () => {
  beforeEach(() => {
    // Clear registry before each test
    toolRegistry.clear();
  });

  describe('register', () => {
    it('should register a tool', () => {
      toolRegistry.register({
        id: 'test_tool',
        definition: {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
        handler: async () => 'result',
        source: 'builtin',
      });

      expect(toolRegistry.has('test_tool')).toBe(true);
      expect(toolRegistry.size).toBe(1);
    });

    it('should warn when overwriting an existing tool', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      toolRegistry.register({
        id: 'test_tool',
        definition: {
          type: 'function',
          function: { name: 'test_tool', description: 'First', parameters: {} },
        },
        handler: async () => 'first',
        source: 'builtin',
      });

      toolRegistry.register({
        id: 'test_tool',
        definition: {
          type: 'function',
          function: { name: 'test_tool', description: 'Second', parameters: {} },
        },
        handler: async () => 'second',
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
    it('should unregister a tool', () => {
      toolRegistry.register({
        id: 'test_tool',
        definition: {
          type: 'function',
          function: { name: 'test_tool', description: 'Test', parameters: {} },
        },
        handler: async () => 'result',
        source: 'builtin',
      });

      expect(toolRegistry.unregister('test_tool')).toBe(true);
      expect(toolRegistry.has('test_tool')).toBe(false);
    });

    it('should return false when unregistering non-existent tool', () => {
      expect(toolRegistry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return tool metadata', () => {
      toolRegistry.register({
        id: 'test_tool',
        definition: {
          type: 'function',
          function: { name: 'test_tool', description: 'Test', parameters: {} },
        },
        handler: async () => 'result',
        source: 'plugin',
        pluginId: 'com.example.plugin',
        permissions: ['fs.read'],
      });

      const meta = toolRegistry.get('test_tool');
      expect(meta).toBeDefined();
      expect(meta?.id).toBe('test_tool');
      expect(meta?.source).toBe('plugin');
      expect(meta?.pluginId).toBe('com.example.plugin');
      expect(meta?.permissions).toContain('fs.read');
    });

    it('should return undefined for non-existent tool', () => {
      expect(toolRegistry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllDefinitions', () => {
    it('should return all tool definitions', () => {
      toolRegistry.register({
        id: 'tool1',
        definition: {
          type: 'function',
          function: { name: 'tool1', description: 'Tool 1', parameters: {} },
        },
        handler: async () => 'result',
        source: 'builtin',
      });

      toolRegistry.register({
        id: 'tool2',
        definition: {
          type: 'function',
          function: { name: 'tool2', description: 'Tool 2', parameters: {} },
        },
        handler: async () => 'result',
        source: 'plugin',
        pluginId: 'com.example.plugin',
      });

      const definitions = toolRegistry.getAllDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions.map((d) => d.function.name)).toContain('tool1');
      expect(definitions.map((d) => d.function.name)).toContain('tool2');
    });
  });

  describe('getDefinitionsBySource', () => {
    it('should filter definitions by source', () => {
      toolRegistry.register({
        id: 'builtin_tool',
        definition: {
          type: 'function',
          function: { name: 'builtin_tool', description: 'Builtin', parameters: {} },
        },
        handler: async () => 'result',
        source: 'builtin',
      });

      toolRegistry.register({
        id: 'plugin_tool',
        definition: {
          type: 'function',
          function: { name: 'plugin_tool', description: 'Plugin', parameters: {} },
        },
        handler: async () => 'result',
        source: 'plugin',
        pluginId: 'com.example.plugin',
      });

      const builtin = toolRegistry.getDefinitionsBySource('builtin');
      expect(builtin).toHaveLength(1);
      expect(builtin[0].function.name).toBe('builtin_tool');

      const plugin = toolRegistry.getDefinitionsBySource('plugin');
      expect(plugin).toHaveLength(1);
      expect(plugin[0].function.name).toBe('plugin_tool');
    });
  });

  describe('execute', () => {
    it('should execute a tool and return result', async () => {
      toolRegistry.register({
        id: 'echo',
        definition: {
          type: 'function',
          function: { name: 'echo', description: 'Echo', parameters: {} },
        },
        handler: async (args) => JSON.stringify({ echoed: args.message }),
        source: 'builtin',
      });

      const toolCall: ToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'echo',
          arguments: '{"message": "hello"}',
        },
      };

      const result = await toolRegistry.execute(toolCall);
      expect(result).toBe('{"echoed":"hello"}');
    });

    it('should return error for unknown tool', async () => {
      const toolCall: ToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'unknown_tool',
          arguments: '{}',
        },
      };

      const result = await toolRegistry.execute(toolCall);
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Unknown tool');
    });

    it('should handle handler errors', async () => {
      toolRegistry.register({
        id: 'failing_tool',
        definition: {
          type: 'function',
          function: { name: 'failing_tool', description: 'Fails', parameters: {} },
        },
        handler: async () => {
          throw new Error('Handler failed');
        },
        source: 'builtin',
      });

      const toolCall: ToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'failing_tool',
          arguments: '{}',
        },
      };

      const result = await toolRegistry.execute(toolCall);
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Tool execution failed');
      expect(parsed.error).toContain('Handler failed');
    });

    it('should handle invalid JSON arguments', async () => {
      toolRegistry.register({
        id: 'test_tool',
        definition: {
          type: 'function',
          function: { name: 'test_tool', description: 'Test', parameters: {} },
        },
        handler: async () => 'result',
        source: 'builtin',
      });

      const toolCall: ToolCall = {
        id: 'call_123',
        type: 'function',
        function: {
          name: 'test_tool',
          arguments: 'not valid json',
        },
      };

      const result = await toolRegistry.execute(toolCall);
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Tool execution failed');
    });
  });

  describe('clearByPlugin', () => {
    it('should clear all tools from a specific plugin', () => {
      toolRegistry.register({
        id: 'plugin1_tool1',
        definition: {
          type: 'function',
          function: { name: 'plugin1_tool1', description: 'P1T1', parameters: {} },
        },
        handler: async () => 'result',
        source: 'plugin',
        pluginId: 'com.plugin1',
      });

      toolRegistry.register({
        id: 'plugin1_tool2',
        definition: {
          type: 'function',
          function: { name: 'plugin1_tool2', description: 'P1T2', parameters: {} },
        },
        handler: async () => 'result',
        source: 'plugin',
        pluginId: 'com.plugin1',
      });

      toolRegistry.register({
        id: 'plugin2_tool',
        definition: {
          type: 'function',
          function: { name: 'plugin2_tool', description: 'P2T', parameters: {} },
        },
        handler: async () => 'result',
        source: 'plugin',
        pluginId: 'com.plugin2',
      });

      const count = toolRegistry.clearByPlugin('com.plugin1');
      expect(count).toBe(2);
      expect(toolRegistry.size).toBe(1);
      expect(toolRegistry.has('plugin2_tool')).toBe(true);
    });
  });

  describe('getByPlugin', () => {
    it('should get all tools from a specific plugin', () => {
      toolRegistry.register({
        id: 'tool1',
        definition: {
          type: 'function',
          function: { name: 'tool1', description: 'T1', parameters: {} },
        },
        handler: async () => 'result',
        source: 'plugin',
        pluginId: 'com.example.plugin',
      });

      toolRegistry.register({
        id: 'tool2',
        definition: {
          type: 'function',
          function: { name: 'tool2', description: 'T2', parameters: {} },
        },
        handler: async () => 'result',
        source: 'builtin',
      });

      const pluginTools = toolRegistry.getByPlugin('com.example.plugin');
      expect(pluginTools).toHaveLength(1);
      expect(pluginTools[0].id).toBe('tool1');
    });
  });
});

describe('registerTool helper', () => {
  beforeEach(() => {
    toolRegistry.clear();
  });

  it('should register a tool with simpler API', () => {
    registerTool(
      {
        id: 'simple_tool',
        name: 'simple_tool',
        description: 'A simple tool',
        parameters: { type: 'object', properties: { input: { type: 'string' } } },
        handler: async (args) => `Got: ${args.input}`,
      },
      'plugin',
      'com.example.plugin'
    );

    expect(toolRegistry.has('simple_tool')).toBe(true);
    const meta = toolRegistry.get('simple_tool');
    expect(meta?.source).toBe('plugin');
    expect(meta?.pluginId).toBe('com.example.plugin');
    expect(meta?.definition.function.name).toBe('simple_tool');
  });

  it('should default to plugin source', () => {
    registerTool({
      id: 'default_tool',
      name: 'default_tool',
      description: 'Default source',
      parameters: {},
      handler: async () => 'result',
    });

    const meta = toolRegistry.get('default_tool');
    expect(meta?.source).toBe('plugin');
  });
});
