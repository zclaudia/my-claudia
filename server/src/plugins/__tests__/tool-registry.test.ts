/**
 * Unit tests for ToolRegistry
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toolRegistry, type ToolScope } from '../tool-registry.js';
import type { ToolDefinition } from '@my-claudia/shared';

describe('ToolRegistry', () => {
  beforeEach(() => {
    toolRegistry.clear();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({
        id: 'test_tool',
        definition,
        handler: () => 'result',
        source: 'builtin',
      });

      expect(toolRegistry.has('test_tool')).toBe(true);
      expect(toolRegistry.size).toBe(1);
    });

    it('should warn when overwriting an existing tool', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      toolRegistry.register({
        id: 'test_tool',
        definition,
        handler: () => 'result1',
        source: 'builtin',
      });

      toolRegistry.register({
        id: 'test_tool',
        definition,
        handler: () => 'result2',
        source: 'plugin',
        pluginId: 'test.plugin',
      });

      expect(warnSpy).toHaveBeenCalled();
      expect(toolRegistry.size).toBe(1);

      warnSpy.mockRestore();
    });
  });

  describe('unregister', () => {
    it('should unregister a tool', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({
        id: 'test_tool',
        definition,
        handler: () => 'result',
        source: 'builtin',
      });

      expect(toolRegistry.unregister('test_tool')).toBe(true);
      expect(toolRegistry.has('test_tool')).toBe(false);
    });

    it('should return false for non-existent tool', () => {
      expect(toolRegistry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return tool metadata', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({
        id: 'test_tool',
        definition,
        handler: () => 'result',
        source: 'builtin',
        permissions: ['fs.read'],
      });

      const meta = toolRegistry.get('test_tool');
      expect(meta).toBeDefined();
      expect(meta?.id).toBe('test_tool');
      expect(meta?.source).toBe('builtin');
      expect(meta?.permissions).toContain('fs.read');
    });

    it('should return undefined for non-existent tool', () => {
      expect(toolRegistry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getAllDefinitions', () => {
    it('should return all tool definitions', () => {
      const definition1: ToolDefinition = {
        type: 'function',
        function: {
          name: 'tool1',
          description: 'Tool 1',
          parameters: { type: 'object', properties: {} },
        },
      };

      const definition2: ToolDefinition = {
        type: 'function',
        function: {
          name: 'tool2',
          description: 'Tool 2',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({ id: 'tool1', definition: definition1, handler: () => '1', source: 'builtin' });
      toolRegistry.register({ id: 'tool2', definition: definition2, handler: () => '2', source: 'plugin', pluginId: 'test' });

      const definitions = toolRegistry.getAllDefinitions();
      expect(definitions).toHaveLength(2);
      expect(definitions.map(d => d.function.name)).toContain('tool1');
      expect(definitions.map(d => d.function.name)).toContain('tool2');
    });
  });

  describe('getDefinitionsBySource', () => {
    it('should filter definitions by source', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({ id: 'builtin_tool', definition, handler: () => '1', source: 'builtin' });
      toolRegistry.register({ id: 'plugin_tool', definition, handler: () => '2', source: 'plugin', pluginId: 'test' });

      const builtin = toolRegistry.getDefinitionsBySource('builtin');
      expect(builtin).toHaveLength(1);

      const plugin = toolRegistry.getDefinitionsBySource('plugin');
      expect(plugin).toHaveLength(1);
    });
  });

  describe('getDefinitionsByScope', () => {
    it('should filter definitions by scope', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      // Tool with specific scope
      toolRegistry.register({
        id: 'scoped_tool',
        definition,
        handler: () => '1',
        source: 'builtin',
        scope: ['agent-assistant', 'main-session'],
      });

      // Tool without scope (available everywhere)
      toolRegistry.register({
        id: 'global_tool',
        definition,
        handler: () => '2',
        source: 'builtin',
      });

      // Tool with different scope
      toolRegistry.register({
        id: 'palette_tool',
        definition,
        handler: () => '3',
        source: 'builtin',
        scope: ['command-palette'],
      });

      const agentAssistant = toolRegistry.getDefinitionsByScope('agent-assistant');
      expect(agentAssistant).toHaveLength(2); // scoped_tool + global_tool

      const commandPalette = toolRegistry.getDefinitionsByScope('command-palette');
      expect(commandPalette).toHaveLength(2); // palette_tool + global_tool

      const mainSession = toolRegistry.getDefinitionsByScope('main-session');
      expect(mainSession).toHaveLength(2); // scoped_tool + global_tool
    });
  });

  describe('execute', () => {
    it('should execute a tool handler', async () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({
        id: 'test_tool',
        definition,
        handler: (args) => JSON.stringify({ received: args }),
        source: 'builtin',
      });

      const result = await toolRegistry.execute('test_tool', { foo: 'bar' });
      expect(result).toBe(JSON.stringify({ received: { foo: 'bar' } }));
    });

    it('should return error for unknown tool', async () => {
      const result = await toolRegistry.execute('unknown', {});
      expect(result).toContain('Unknown tool');
    });

    it('should handle handler errors', async () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'error_tool',
          description: 'A tool that errors',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({
        id: 'error_tool',
        definition,
        handler: () => {
          throw new Error('Handler error');
        },
        source: 'builtin',
      });

      const result = await toolRegistry.execute('error_tool', {});
      expect(result).toContain('Tool execution failed');
      expect(result).toContain('Handler error');
    });
  });

  describe('getByPlugin', () => {
    it('should return tools for a specific plugin', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({ id: 'tool1', definition, handler: () => '1', source: 'plugin', pluginId: 'plugin.a' });
      toolRegistry.register({ id: 'tool2', definition, handler: () => '2', source: 'plugin', pluginId: 'plugin.b' });
      toolRegistry.register({ id: 'tool3', definition, handler: () => '3', source: 'builtin' });

      const pluginATools = toolRegistry.getByPlugin('plugin.a');
      expect(pluginATools).toHaveLength(1);
      expect(pluginATools[0].id).toBe('tool1');
    });
  });

  describe('clearByPlugin', () => {
    it('should clear all tools for a specific plugin', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({ id: 'tool1', definition, handler: () => '1', source: 'plugin', pluginId: 'plugin.a' });
      toolRegistry.register({ id: 'tool2', definition, handler: () => '2', source: 'plugin', pluginId: 'plugin.b' });
      toolRegistry.register({ id: 'tool3', definition, handler: () => '3', source: 'builtin' });

      const count = toolRegistry.clearByPlugin('plugin.a');
      expect(count).toBe(1);
      expect(toolRegistry.has('tool1')).toBe(false);
      expect(toolRegistry.has('tool2')).toBe(true);
      expect(toolRegistry.has('tool3')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all tools', () => {
      const definition: ToolDefinition = {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
        },
      };

      toolRegistry.register({ id: 'tool1', definition, handler: () => '1', source: 'builtin' });
      toolRegistry.register({ id: 'tool2', definition, handler: () => '2', source: 'plugin', pluginId: 'test' });

      toolRegistry.clear();
      expect(toolRegistry.size).toBe(0);
    });
  });
});
