import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerMessage } from '@my-claudia/shared';

// Mock node-pty
const mockPtyKill = vi.fn();
const mockPtyWrite = vi.fn();
const mockPtyResize = vi.fn();
let mockOnDataCallback: ((data: string) => void) | null = null;
let mockOnExitCallback: ((e: { exitCode: number }) => void) | null = null;

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: (cb: (data: string) => void) => { mockOnDataCallback = cb; },
    onExit: (cb: (e: { exitCode: number }) => void) => { mockOnExitCallback = cb; },
    write: mockPtyWrite,
    resize: mockPtyResize,
    kill: mockPtyKill,
  })),
}));

import { TerminalManager } from '../terminal-manager.js';
import * as pty from 'node-pty';

describe('TerminalManager', () => {
  let manager: TerminalManager;
  let sentMessages: Array<{ clientId: string; msg: ServerMessage }>;

  beforeEach(() => {
    vi.useFakeTimers();
    sentMessages = [];
    manager = new TerminalManager((clientId, msg) => {
      sentMessages.push({ clientId, msg });
    });
    mockOnDataCallback = null;
    mockOnExitCallback = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    manager.destroyAll();
    vi.useRealTimers();
  });

  describe('create', () => {
    it('spawns a PTY with correct options', () => {
      manager.create('term-1', 'client-1', '/home/test', 80, 24);

      expect(pty.spawn).toHaveBeenCalledWith(
        expect.any(String),
        [],
        expect.objectContaining({
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: '/home/test',
        }),
      );
    });

    it('sends terminal_output when PTY emits data', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      expect(mockOnDataCallback).not.toBeNull();

      mockOnDataCallback!('hello world');

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toEqual({
        clientId: 'client-1',
        msg: { type: 'terminal_output', terminalId: 'term-1', data: 'hello world' },
      });
    });

    it('sends terminal_exited when PTY exits', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      expect(mockOnExitCallback).not.toBeNull();

      mockOnExitCallback!({ exitCode: 0 });

      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toEqual({
        clientId: 'client-1',
        msg: { type: 'terminal_exited', terminalId: 'term-1', exitCode: 0 },
      });
    });

    it('destroys existing terminal with same ID before creating new one', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      manager.create('term-1', 'client-2', '/tmp', 100, 30);

      expect(mockPtyKill).toHaveBeenCalledTimes(1); // old one killed
      expect(pty.spawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('write', () => {
    it('writes data to the PTY', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      manager.write('term-1', 'ls\n');

      expect(mockPtyWrite).toHaveBeenCalledWith('ls\n');
    });

    it('does nothing for non-existent terminal', () => {
      manager.write('non-existent', 'data');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });

    it('resets idle timer on write', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);

      // Advance 29 minutes
      vi.advanceTimersByTime(29 * 60 * 1000);

      // Write resets the timer
      manager.write('term-1', 'x');

      // Advance another 29 minutes — should still be alive because timer was reset
      vi.advanceTimersByTime(29 * 60 * 1000);
      manager.write('term-1', 'y');
      expect(mockPtyWrite).toHaveBeenCalledTimes(2);

      // Now advance 30 minutes without writing — idle timeout fires
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(mockPtyKill).toHaveBeenCalled();
    });
  });

  describe('resize', () => {
    it('resizes the PTY', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      manager.resize('term-1', 120, 40);

      expect(mockPtyResize).toHaveBeenCalledWith(120, 40);
    });

    it('does nothing for non-existent terminal', () => {
      manager.resize('non-existent', 120, 40);
      expect(mockPtyResize).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('kills the PTY and removes from map', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      manager.destroy('term-1');

      expect(mockPtyKill).toHaveBeenCalledTimes(1);

      // Write to destroyed terminal should be no-op
      manager.write('term-1', 'data');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });

    it('does nothing for non-existent terminal', () => {
      manager.destroy('non-existent');
      expect(mockPtyKill).not.toHaveBeenCalled();
    });
  });

  describe('destroyForClient', () => {
    it('destroys all terminals belonging to a client', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks();
      manager.create('term-2', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks();
      manager.create('term-3', 'client-2', '/tmp', 80, 24);
      vi.clearAllMocks();

      manager.destroyForClient('client-1');

      expect(mockPtyKill).toHaveBeenCalledTimes(2);

      // client-2's terminal should still work
      manager.write('term-3', 'data');
      expect(mockPtyWrite).toHaveBeenCalled();
    });

    it('does nothing when client has no terminals', () => {
      manager.destroyForClient('no-such-client');
      expect(mockPtyKill).not.toHaveBeenCalled();
    });
  });

  describe('destroyAll', () => {
    it('destroys all terminals', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);
      vi.clearAllMocks();
      manager.create('term-2', 'client-2', '/tmp', 80, 24);
      vi.clearAllMocks();

      manager.destroyAll();

      expect(mockPtyKill).toHaveBeenCalledTimes(2);

      // All terminals should be gone
      manager.write('term-1', 'data');
      manager.write('term-2', 'data');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });
  });

  describe('idle timeout', () => {
    it('destroys terminal after 30 minutes of inactivity', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);

      vi.advanceTimersByTime(30 * 60 * 1000);

      expect(mockPtyKill).toHaveBeenCalledTimes(1);

      // Terminal should be gone
      manager.write('term-1', 'data');
      expect(mockPtyWrite).not.toHaveBeenCalled();
    });

    it('does not destroy terminal before 30 minutes', () => {
      manager.create('term-1', 'client-1', '/tmp', 80, 24);

      vi.advanceTimersByTime(29 * 60 * 1000);

      expect(mockPtyKill).not.toHaveBeenCalled();
    });
  });
});
