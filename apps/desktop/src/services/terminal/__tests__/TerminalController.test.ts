import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ITheme } from '@xterm/xterm';
import type { ServerMessage } from '@my-claudia/shared';
import { TerminalController, type TerminalControllerDeps } from '../TerminalController';

/**
 * Tests run in node env (vitest unit pool). xterm/FitAddon are mocked via the
 * `factories` deps hook so we don't pull in DOM-bound xterm internals at all.
 */

interface FakeXterm {
  cols: number;
  rows: number;
  element?: HTMLElement;
  options: { theme?: ITheme };
  open: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  loadAddon: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  writeln: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  // last bound onData callback, for tests to drive
  __dataCb?: (data: string) => void;
}

function makeXterm(overrides: Partial<FakeXterm> = {}): FakeXterm {
  const term: FakeXterm = {
    cols: 80,
    rows: 24,
    options: {},
    open: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    write: vi.fn(),
    writeln: vi.fn(),
    focus: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => {
      term.__dataCb = cb;
      return { dispose: vi.fn() };
    }),
    ...overrides,
  };
  return term;
}

function makeFit() {
  return {
    fit: vi.fn(),
    dispose: vi.fn(),
    activate: vi.fn(),
  };
}

const FAKE_THEME: ITheme = { background: '#000', foreground: '#fff' };

function buildDeps(overrides: Partial<TerminalControllerDeps> = {}) {
  const sendMessage = vi.fn();
  const xterm = makeXterm();
  const fit = makeFit();
  const deps: TerminalControllerDeps = {
    terminalId: 't-1',
    sendMessage,
    getTheme: () => FAKE_THEME,
    factories: {
      createTerminal: vi.fn(() => xterm as any),
      createFitAddon: vi.fn(() => fit as any),
    },
    logger: { warn: vi.fn() },
    ...overrides,
  };
  return { deps, sendMessage, xterm, fit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TerminalController — actions and transitions', () => {
  it('starts in idle and transitions to opening after open()', () => {
    const { deps, sendMessage } = buildDeps();
    const c = new TerminalController(deps);
    expect(c.getState()).toEqual({ kind: 'idle' });

    c.open({ projectId: 'proj-1', workingDirectory: '/tmp' });

    expect(c.getState()).toEqual({ kind: 'opening' });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_open',
      terminalId: 't-1',
      projectId: 'proj-1',
      workingDirectory: '/tmp',
      cols: 80,
      rows: 24,
    }));
  });

  it('terminal_opened(success) transitions opening -> open', () => {
    const { deps } = buildDeps();
    const c = new TerminalController(deps);
    c.open({ projectId: 'p' });
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);
    expect(c.getState()).toEqual({ kind: 'open' });
  });

  it('terminal_opened(failure) transitions opening -> failed with error', () => {
    const { deps } = buildDeps();
    const c = new TerminalController(deps);
    c.open({ projectId: 'p' });
    c.handleServerMessage({
      type: 'terminal_opened', terminalId: 't-1', success: false, error: 'spawn failed',
    } as ServerMessage);
    expect(c.getState()).toEqual({ kind: 'failed', error: 'spawn failed' });
  });

  it('attach() sends terminal_attach (no projectId) and transitions to attaching', () => {
    const { deps, sendMessage } = buildDeps();
    const c = new TerminalController(deps);
    c.attach();
    expect(c.getState()).toEqual({ kind: 'attaching' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'terminal_attach',
      terminalId: 't-1',
      cols: 80,
      rows: 24,
    });
  });

  it('terminal_attached(success) flushes scrollback and transitions to open', () => {
    const { deps, xterm } = buildDeps();
    const c = new TerminalController(deps);
    c.attach();

    c.handleServerMessage({
      type: 'terminal_attached',
      terminalId: 't-1',
      success: true,
      scrollback: ['hello\r\n', 'world\r\n'],
    } as ServerMessage);

    expect(xterm.write).toHaveBeenNthCalledWith(1, 'hello\r\n');
    expect(xterm.write).toHaveBeenNthCalledWith(2, 'world\r\n');
    expect(c.getState()).toEqual({ kind: 'open' });
  });

  it('terminal_attached(success) with pendingExit transitions attaching → exited and writes the banner', () => {
    const { deps, xterm } = buildDeps();
    const c = new TerminalController(deps);
    c.attach();

    c.handleServerMessage({
      type: 'terminal_attached',
      terminalId: 't-1',
      success: true,
      scrollback: ['last line\r\n'],
      pendingExit: { exitCode: 0 },
    } as ServerMessage);

    expect(xterm.write).toHaveBeenCalledWith('last line\r\n');
    expect(xterm.write).toHaveBeenCalledWith(expect.stringContaining('Process exited with code 0'));
    expect(c.getState()).toEqual({ kind: 'exited', code: 0 });
  });

  it('terminal_attached("Terminal not found") transitions to failed', () => {
    const { deps } = buildDeps();
    const c = new TerminalController(deps);
    c.attach();
    c.handleServerMessage({
      type: 'terminal_attached',
      terminalId: 't-1',
      success: false,
      error: 'Terminal not found',
    } as ServerMessage);
    expect(c.getState()).toEqual({ kind: 'failed', error: 'Terminal not found' });
  });

  it('detach(reason) sends terminal_detach and transitions open -> detached', () => {
    const { deps, sendMessage } = buildDeps();
    const c = new TerminalController(deps);
    c.open({ projectId: 'p' });
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);

    sendMessage.mockClear();
    c.detach('backend_offline');

    expect(c.getState()).toEqual({ kind: 'detached', reason: 'backend_offline' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'terminal_detach', terminalId: 't-1' });
  });

  it('detach() is a no-op when not in open state', () => {
    const { deps, sendMessage } = buildDeps();
    const c = new TerminalController(deps);
    c.detach('popout');
    expect(c.getState()).toEqual({ kind: 'idle' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('release() disposes xterm, sends detach, and transitions open -> detached(popout)', () => {
    const { deps, sendMessage, xterm } = buildDeps();
    const c = new TerminalController(deps);
    c.open({ projectId: 'p' });
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);
    sendMessage.mockClear();

    c.release();

    expect(xterm.dispose).toHaveBeenCalled();
    expect(c.getState()).toEqual({ kind: 'detached', reason: 'popout' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'terminal_detach', terminalId: 't-1' });
  });

  it('claim() rebuilds xterm and sends terminal_attach', () => {
    const { deps, sendMessage } = buildDeps();
    const c = new TerminalController(deps);
    // Drive into detached(popout) via release()
    c.open({ projectId: 'p' });
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);
    c.release();
    sendMessage.mockClear();

    c.claim();

    expect(c.getState()).toEqual({ kind: 'attaching' });
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal_attach' }));
  });

  it('close() sends terminal_close and disposes', () => {
    const { deps, sendMessage } = buildDeps();
    const c = new TerminalController(deps);
    c.open({ projectId: 'p' });

    c.close();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'terminal_close', terminalId: 't-1' });
    expect(c.getState()).toEqual({ kind: 'disposed' });
  });

  it('terminal_exited transitions open -> exited and writes the exit banner', () => {
    const { deps, xterm } = buildDeps();
    const c = new TerminalController(deps);
    c.open({ projectId: 'p' });
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);

    c.handleServerMessage({ type: 'terminal_exited', terminalId: 't-1', exitCode: 137 } as ServerMessage);

    expect(xterm.write).toHaveBeenCalledWith(expect.stringContaining('Process exited with code 137'));
    expect(c.getState()).toEqual({ kind: 'exited', code: 137 });
  });

  it('illegal transitions are silently ignored and logged', () => {
    const warn = vi.fn();
    const { deps } = buildDeps({ logger: { warn } });
    const c = new TerminalController(deps);

    // attach() from idle is fine (idle -> attaching is allowed); try open() from attaching (illegal).
    c.attach();
    c.open({ projectId: 'p' });

    expect(c.getState()).toEqual({ kind: 'attaching' }); // unchanged
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('illegal transition attaching -> opening'));
  });

  it('dispose() is idempotent and clears subscribers', () => {
    const { deps } = buildDeps();
    const c = new TerminalController(deps);
    const listener = vi.fn();
    c.subscribe(listener);

    c.dispose();
    c.dispose();

    expect(c.getState()).toEqual({ kind: 'disposed' });
    // dispose triggers the final notification, but a second dispose() must NOT re-notify.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('TerminalController — onData binding', () => {
  it('binds onData exactly once across multiple open/attach calls', () => {
    const { deps, sendMessage, xterm } = buildDeps();
    const c = new TerminalController(deps);

    c.open({ projectId: 'p' });
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);
    c.detach('backend_offline');
    c.attach();
    c.handleServerMessage({ type: 'terminal_attached', terminalId: 't-1', success: true } as ServerMessage);

    expect(xterm.onData).toHaveBeenCalledTimes(1);

    // A keystroke goes through exactly once, not N times.
    sendMessage.mockClear();
    xterm.__dataCb?.('a');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'terminal_input',
      terminalId: 't-1',
      data: 'a',
    });
  });

  it('disposes the onData handler on release()', () => {
    const dispose = vi.fn();
    const xterm = makeXterm();
    xterm.onData = vi.fn(() => ({ dispose }));
    const { deps } = buildDeps({
      factories: {
        createTerminal: () => xterm as any,
        createFitAddon: () => makeFit() as any,
      },
    });
    const c = new TerminalController(deps);

    c.open({ projectId: 'p' });
    c.release();

    expect(dispose).toHaveBeenCalled();
  });
});

describe('TerminalController — server message routing', () => {
  it('ignores messages for a different terminalId', () => {
    const { deps, xterm } = buildDeps();
    const c = new TerminalController(deps);
    c.open({ projectId: 'p' });

    c.handleServerMessage({ type: 'terminal_opened', terminalId: 'other', success: true } as ServerMessage);
    c.handleServerMessage({ type: 'terminal_output', terminalId: 'other', data: 'x' } as ServerMessage);

    expect(c.getState()).toEqual({ kind: 'opening' });
    expect(xterm.write).not.toHaveBeenCalled();
  });

  it('ignores terminal_opened when not in opening state', () => {
    const { deps } = buildDeps();
    const c = new TerminalController(deps);
    // idle, no open() called
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);
    expect(c.getState()).toEqual({ kind: 'idle' });
  });

  it('routes terminal_output to xterm.write', () => {
    const { deps, xterm } = buildDeps();
    const c = new TerminalController(deps);
    c.open({ projectId: 'p' });
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);

    c.handleServerMessage({ type: 'terminal_output', terminalId: 't-1', data: 'shell$ ' } as ServerMessage);
    expect(xterm.write).toHaveBeenCalledWith('shell$ ');
  });
});

describe('TerminalController — subscriptions', () => {
  it('notifies subscribers on each transition', () => {
    const { deps } = buildDeps();
    const c = new TerminalController(deps);
    const seen: string[] = [];
    c.subscribe((s) => seen.push(s.kind));

    c.open({ projectId: 'p' });
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);
    c.detach('ws_reconnect');

    expect(seen).toEqual(['opening', 'open', 'detached']);
  });

  it('unsubscribe stops further notifications', () => {
    const { deps } = buildDeps();
    const c = new TerminalController(deps);
    const listener = vi.fn();
    const unsub = c.subscribe(listener);
    c.open({ projectId: 'p' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    c.handleServerMessage({ type: 'terminal_opened', terminalId: 't-1', success: true } as ServerMessage);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
