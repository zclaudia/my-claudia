import { describe, it, expect, vi, beforeEach } from 'vitest';
import { xtermRegistry } from '../xtermRegistry.js';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

describe('utils/xtermRegistry', () => {
  let mockTerminal: Terminal;
  let mockFitAddon: FitAddon;

  beforeEach(() => {
    mockTerminal = {
      dispose: vi.fn(),
    } as unknown as Terminal;

    mockFitAddon = {} as FitAddon;
  });

  describe('set', () => {
    it('stores terminal entry', () => {
      xtermRegistry.set('terminal-1', mockTerminal, mockFitAddon);

      expect(xtermRegistry.has('terminal-1')).toBe(true);
    });

    it('overwrites existing entry with same id', () => {
      const mockTerminal2 = { dispose: vi.fn() } as unknown as Terminal;

      xtermRegistry.set('terminal-1', mockTerminal, mockFitAddon);
      xtermRegistry.set('terminal-1', mockTerminal2, mockFitAddon);

      const entry = xtermRegistry.get('terminal-1');
      expect(entry?.terminal).toBe(mockTerminal2);
    });
  });

  describe('get', () => {
    it('retrieves terminal entry', () => {
      xtermRegistry.set('terminal-1', mockTerminal, mockFitAddon);

      const entry = xtermRegistry.get('terminal-1');

      expect(entry).toBeDefined();
      expect(entry?.terminal).toBe(mockTerminal);
      expect(entry?.fitAddon).toBe(mockFitAddon);
      expect(entry?.serverOpened).toBe(false);
    });

    it('returns undefined for non-existent terminal', () => {
      const entry = xtermRegistry.get('non-existent');

      expect(entry).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for existing terminal', () => {
      xtermRegistry.set('terminal-1', mockTerminal, mockFitAddon);

      expect(xtermRegistry.has('terminal-1')).toBe(true);
    });

    it('returns false for non-existent terminal', () => {
      expect(xtermRegistry.has('non-existent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes terminal and disposes it', () => {
      xtermRegistry.set('terminal-1', mockTerminal, mockFitAddon);
      xtermRegistry.delete('terminal-1');

      expect(mockTerminal.dispose).toHaveBeenCalled();
      expect(xtermRegistry.has('terminal-1')).toBe(false);
    });

    it('does nothing for non-existent terminal', () => {
      // Should not throw
      expect(() => xtermRegistry.delete('non-existent')).not.toThrow();
    });

    it('removes entry from registry', () => {
      xtermRegistry.set('terminal-1', mockTerminal, mockFitAddon);
      xtermRegistry.delete('terminal-1');

      const entry = xtermRegistry.get('terminal-1');
      expect(entry).toBeUndefined();
    });
  });

  describe('serverOpened flag', () => {
    it('is initially false', () => {
      xtermRegistry.set('terminal-1', mockTerminal, mockFitAddon);

      const entry = xtermRegistry.get('terminal-1');
      expect(entry?.serverOpened).toBe(false);
    });

    it('can be modified', () => {
      xtermRegistry.set('terminal-1', mockTerminal, mockFitAddon);

      const entry = xtermRegistry.get('terminal-1');
      if (entry) {
        entry.serverOpened = true;
      }

      const updated = xtermRegistry.get('terminal-1');
      expect(updated?.serverOpened).toBe(true);
    });
  });
});
