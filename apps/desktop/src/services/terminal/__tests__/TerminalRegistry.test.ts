import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ITheme } from '@xterm/xterm';
import type { ServerMessage } from '@my-claudia/shared';
import { createTerminalRegistry } from '../TerminalRegistry';
import type { TerminalControllerDeps } from '../TerminalController';

const FAKE_THEME: ITheme = { background: '#000', foreground: '#fff' };

function makeXterm() {
  return {
    cols: 80,
    rows: 24,
    options: {} as { theme?: ITheme },
    open: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    focus: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function makeFit() {
  return { fit: vi.fn(), dispose: vi.fn(), activate: vi.fn() };
}

function deps(terminalId: string): TerminalControllerDeps {
  return {
    terminalId,
    sendMessage: vi.fn(),
    getTheme: () => FAKE_THEME,
    factories: {
      createTerminal: () => makeXterm() as any,
      createFitAddon: () => makeFit() as any,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TerminalRegistry', () => {
  it('getOrCreate returns the same controller for the same terminalId', () => {
    const reg = createTerminalRegistry();
    const a = reg.getOrCreate('t-1', deps('t-1'));
    const b = reg.getOrCreate('t-1', deps('t-1'));
    expect(a).toBe(b);
    expect(reg.size()).toBe(1);
  });

  it('getOrCreate creates separate controllers for different terminalIds', () => {
    const reg = createTerminalRegistry();
    const a = reg.getOrCreate('t-1', deps('t-1'));
    const b = reg.getOrCreate('t-2', deps('t-2'));
    expect(a).not.toBe(b);
    expect(reg.size()).toBe(2);
  });

  it('get returns undefined for unknown terminalId', () => {
    const reg = createTerminalRegistry();
    expect(reg.get('missing')).toBeUndefined();
    expect(reg.has('missing')).toBe(false);
  });

  it('delete disposes the controller and removes it from the registry', () => {
    const reg = createTerminalRegistry();
    const c = reg.getOrCreate('t-1', deps('t-1'));
    const disposeSpy = vi.spyOn(c, 'dispose');

    reg.delete('t-1');

    expect(disposeSpy).toHaveBeenCalled();
    expect(reg.has('t-1')).toBe(false);
    expect(reg.get('t-1')).toBeUndefined();
  });

  it('delete on missing terminalId is a no-op', () => {
    const reg = createTerminalRegistry();
    expect(() => reg.delete('missing')).not.toThrow();
  });

  it('forEach iterates every live controller', () => {
    const reg = createTerminalRegistry();
    reg.getOrCreate('t-1', deps('t-1'));
    reg.getOrCreate('t-2', deps('t-2'));
    reg.getOrCreate('t-3', deps('t-3'));

    const seen: string[] = [];
    reg.forEach((_, id) => seen.push(id));

    expect(seen.sort()).toEqual(['t-1', 't-2', 't-3']);
  });

  it('clear disposes everything and empties the registry', () => {
    const reg = createTerminalRegistry();
    const a = reg.getOrCreate('t-1', deps('t-1'));
    const b = reg.getOrCreate('t-2', deps('t-2'));
    const aDispose = vi.spyOn(a, 'dispose');
    const bDispose = vi.spyOn(b, 'dispose');

    reg.clear();

    expect(aDispose).toHaveBeenCalled();
    expect(bDispose).toHaveBeenCalled();
    expect(reg.size()).toBe(0);
  });

  it('dispatchServerMessage routes to the matching controller', () => {
    const reg = createTerminalRegistry();
    const c = reg.getOrCreate('t-1', deps('t-1'));
    const handle = vi.spyOn(c, 'handleServerMessage');

    const msg: ServerMessage = {
      type: 'terminal_output',
      terminalId: 't-1',
      data: 'hi',
    } as ServerMessage;
    const dispatched = reg.dispatchServerMessage(msg);

    expect(dispatched).toBe(true);
    expect(handle).toHaveBeenCalledWith(msg);
  });

  it('dispatchServerMessage returns false when no controller matches', () => {
    const reg = createTerminalRegistry();
    const dispatched = reg.dispatchServerMessage({
      type: 'terminal_output',
      terminalId: 'other',
      data: 'hi',
    } as ServerMessage);
    expect(dispatched).toBe(false);
  });

  it('dispatchServerMessage returns false for messages without a terminalId', () => {
    const reg = createTerminalRegistry();
    reg.getOrCreate('t-1', deps('t-1'));
    const dispatched = reg.dispatchServerMessage({ type: 'pong' } as ServerMessage);
    expect(dispatched).toBe(false);
  });
});
