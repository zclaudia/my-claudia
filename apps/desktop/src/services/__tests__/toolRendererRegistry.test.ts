import { describe, it, expect, beforeEach } from 'vitest';
import { toolRendererRegistry, type ToolRendererProps } from '../toolRendererRegistry';

// Mock React component
const MockRenderer = (_props: ToolRendererProps) => null;

describe('toolRendererRegistry', () => {
  beforeEach(() => {
    // Clear the singleton before each test
    toolRendererRegistry.clear();
  });

  describe('register', () => {
    it('registers a renderer', () => {
      toolRendererRegistry.register('my_tool', MockRenderer);

      expect(toolRendererRegistry.has('my_tool')).toBe(true);
      expect(toolRendererRegistry.get('my_tool')).toBe(MockRenderer);
    });

    it('overwrites existing renderer', () => {
      const Renderer1 = (_props: ToolRendererProps) => null;
      const Renderer2 = (_props: ToolRendererProps) => null;

      toolRendererRegistry.register('my_tool', Renderer1);
      toolRendererRegistry.register('my_tool', Renderer2);

      expect(toolRendererRegistry.get('my_tool')).toBe(Renderer2);
    });

    it('can register multiple renderers', () => {
      toolRendererRegistry.register('tool1', MockRenderer);
      toolRendererRegistry.register('tool2', MockRenderer);
      toolRendererRegistry.register('tool3', MockRenderer);

      expect(toolRendererRegistry.size).toBe(3);
    });
  });

  describe('unregister', () => {
    it('removes a renderer', () => {
      toolRendererRegistry.register('my_tool', MockRenderer);
      toolRendererRegistry.unregister('my_tool');

      expect(toolRendererRegistry.has('my_tool')).toBe(false);
    });

    it('handles non-existent renderer gracefully', () => {
      // Should not throw
      toolRendererRegistry.unregister('non_existent');
    });
  });

  describe('get', () => {
    it('returns registered renderer', () => {
      toolRendererRegistry.register('my_tool', MockRenderer);

      expect(toolRendererRegistry.get('my_tool')).toBe(MockRenderer);
    });

    it('returns undefined for non-existent renderer', () => {
      expect(toolRendererRegistry.get('non_existent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for registered renderer', () => {
      toolRendererRegistry.register('my_tool', MockRenderer);

      expect(toolRendererRegistry.has('my_tool')).toBe(true);
    });

    it('returns false for non-existent renderer', () => {
      expect(toolRendererRegistry.has('non_existent')).toBe(false);
    });
  });

  describe('clearByPrefix', () => {
    beforeEach(() => {
      toolRendererRegistry.register('plugin_tool1', MockRenderer);
      toolRendererRegistry.register('plugin_tool2', MockRenderer);
      toolRendererRegistry.register('other_tool', MockRenderer);
    });

    it('removes all renderers with prefix', () => {
      const count = toolRendererRegistry.clearByPrefix('plugin_');

      expect(count).toBe(2);
      expect(toolRendererRegistry.has('plugin_tool1')).toBe(false);
      expect(toolRendererRegistry.has('plugin_tool2')).toBe(false);
    });

    it('keeps renderers without prefix', () => {
      toolRendererRegistry.clearByPrefix('plugin_');

      expect(toolRendererRegistry.has('other_tool')).toBe(true);
    });

    it('returns count of removed renderers', () => {
      expect(toolRendererRegistry.clearByPrefix('plugin_')).toBe(2);
      expect(toolRendererRegistry.clearByPrefix('nonexistent_')).toBe(0);
    });
  });

  describe('clear', () => {
    it('removes all renderers', () => {
      toolRendererRegistry.register('tool1', MockRenderer);
      toolRendererRegistry.register('tool2', MockRenderer);
      toolRendererRegistry.register('tool3', MockRenderer);

      toolRendererRegistry.clear();

      expect(toolRendererRegistry.size).toBe(0);
    });
  });

  describe('size', () => {
    it('returns correct count', () => {
      expect(toolRendererRegistry.size).toBe(0);

      toolRendererRegistry.register('tool1', MockRenderer);
      expect(toolRendererRegistry.size).toBe(1);

      toolRendererRegistry.register('tool2', MockRenderer);
      expect(toolRendererRegistry.size).toBe(2);

      toolRendererRegistry.unregister('tool1');
      expect(toolRendererRegistry.size).toBe(1);
    });
  });
});

describe('singleton instance', () => {
  it('exports a singleton instance', () => {
    // The toolRendererRegistry should be an object with the expected methods
    expect(toolRendererRegistry).toBeDefined();
    expect(typeof toolRendererRegistry.register).toBe('function');
    expect(typeof toolRendererRegistry.unregister).toBe('function');
    expect(typeof toolRendererRegistry.get).toBe('function');
    expect(typeof toolRendererRegistry.has).toBe('function');
    expect(typeof toolRendererRegistry.clearByPrefix).toBe('function');
    expect(typeof toolRendererRegistry.clear).toBe('function');
  });
});
