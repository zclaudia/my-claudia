/**
 * Refactor baseline for terminal lifecycle behavior.
 *
 * These tests pin down the *observable* contract of the terminal subsystem so the
 * upcoming structural refactor (TerminalController + TerminalRegistry + state machine)
 * can be validated against the same behavior.
 *
 * Scope (intentionally end-to-end across XTerminal + message-handlers + stores +
 * xtermRegistry; only the network layer and xterm.js renderer are mocked):
 *
 *   1. Mount with mode='open'          → terminal_open is sent once active backend is ready
 *   2. Mount with mode='attach'        → terminal_attach is sent once active backend is ready
 *   3. terminal_attached(success)      → scrollback flushed to the xterm instance,
 *                                        reattach flags cleared
 *   4. terminal_attached('Terminal not found')
 *                                      → markReattachFailed, reattach flag stays set so
 *                                        the next render falls back to mode='open'
 *   5. terminal_output                 → xterm.write + markReady
 *   6. terminal_exited                 → xtermRegistry entry disposed + terminal mapping cleared
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { useTerminalStore } from '../../../stores/terminalStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { xtermRegistry } from '../../../utils/xtermRegistry';
import { handleTerminalMessage } from '../../../services/message-handlers/terminal-messages';

// ---------- Network / connection layer ----------
const mockSendMessage = vi.fn();
const mockConnectServer = vi.fn();

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    serverUrl: 'http://localhost:3100',
    isConnected: true,
    activeBackend: 'backend-1',
    setActiveBackend: vi.fn(),
    sendMessage: mockSendMessage,
    connectServer: mockConnectServer,
  }),
}));

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

// ---------- xterm.js renderer (jsdom can't render xterm canvas) ----------
// Class definition lives inside the mock factory because vi.mock is hoisted to the top of the file.
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    open = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    write = vi.fn();
    writeln = vi.fn();
    focus = vi.fn();
    loadAddon = vi.fn();
    options: any = {};
    cols = 80;
    rows = 24;
    element?: HTMLElement;
  }
  return { Terminal: MockTerminal };
});

// Lightweight terminal stub for tests that drive the message handlers directly (do not need
// the real MockTerminal from the mock factory above — that one is for XTerminal renders).
function makeFakeTerminal() {
  return {
    open: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    write: vi.fn(),
    writeln: vi.fn(),
    focus: vi.fn(),
    loadAddon: vi.fn(),
    options: {},
    cols: 80,
    rows: 24,
  } as any;
}
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit = vi.fn(); dispose = vi.fn(); activate = vi.fn(); },
}));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class { dispose = vi.fn(); activate = vi.fn(); },
}));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// ResizeObserver polyfill
globalThis.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

// Force non-zero container size so attach() proceeds past the early return
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });

// Real XTerminal (NOT mocked) — we want to exercise the actual lifecycle effect
import { XTerminal } from '../XTerminal';

// ---------- Helpers ----------
async function flushAttach() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

function clearRegistry() {
  // The module-level Map inside xtermRegistry has no public iterator; iterate via known IDs.
  // Tests that create entries should call this with their own IDs in afterEach.
  // For safety, also try a few common IDs used in this file.
  for (const id of ['t-open', 't-attach', 't-exit', 't-failed', 't-success', 't-output', 't-popout']) {
    if (xtermRegistry.has(id)) xtermRegistry.delete(id);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  clearRegistry();

  useTerminalStore.setState({
    terminals: {},
    readyTerminals: new Set(),
    drawerOpen: {},
    ctrlActive: {},
    poppedOutTerminals: {},
    reattachTerminals: {},
    failedReattachTerminals: {},
  } as any);

  useServerStore.setState({
    activeServerId: 'backend-1',
    connections: {
      'backend-1': { isLocalConnection: false, features: [] },
    },
    localServerPort: null,
    controlPlaneMode: 'gateway-direct',
  });

  useFacadeStore.setState({
    connectionState: 'connected',
    backends: [{ backendId: 'backend-1', runtimeState: 'ready', name: 'Backend 1' }],
  } as any);
});

afterEach(() => {
  clearRegistry();
});

describe('Terminal lifecycle — refactor baseline', () => {
  it('1. mount with mode="open" sends terminal_open with project + dimensions', async () => {
    render(<XTerminal terminalId="t-open" projectId="proj-1" workingDirectory="/tmp" />);
    await flushAttach();

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_open',
      terminalId: 't-open',
      projectId: 'proj-1',
      workingDirectory: '/tmp',
    }));
  });

  it('2. mount with mode="attach" sends terminal_attach (no project)', async () => {
    render(<XTerminal terminalId="t-attach" projectId="proj-1" mode="attach" />);
    await flushAttach();

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_attach',
      terminalId: 't-attach',
    }));
    // attach must NOT include project — that's an open-only field
    const attachCall = mockSendMessage.mock.calls.find(
      (c) => c[0]?.type === 'terminal_attach' && c[0]?.terminalId === 't-attach'
    );
    expect(attachCall?.[0]?.projectId).toBeUndefined();
  });

  it('3. terminal_attached(success) writes scrollback and clears reattach flags', () => {
    // Seed the registry as if XTerminal had already mounted
    const fakeTerminal = makeFakeTerminal();
    xtermRegistry.set('t-success', fakeTerminal as any, { fit: vi.fn() } as any);

    useTerminalStore.getState().markNeedsReattach('t-success');
    expect(useTerminalStore.getState().shouldReattach('t-success')).toBe(true);

    handleTerminalMessage(
      {
        type: 'terminal_attached',
        terminalId: 't-success',
        success: true,
        scrollback: ['hello\r\n', 'world\r\n'],
      } as any,
      'test',
    );

    expect(fakeTerminal.write).toHaveBeenCalledTimes(2);
    expect(fakeTerminal.write).toHaveBeenNthCalledWith(1, 'hello\r\n');
    expect(fakeTerminal.write).toHaveBeenNthCalledWith(2, 'world\r\n');
    expect(useTerminalStore.getState().shouldReattach('t-success')).toBe(false);
    expect(useTerminalStore.getState().hasReattachFailed('t-success')).toBe(false);
    expect(useTerminalStore.getState().isReady('t-success')).toBe(true);
  });

  it('4. terminal_attached(Terminal not found) marks reattach as failed', () => {
    const fakeTerminal = makeFakeTerminal();
    xtermRegistry.set('t-failed', fakeTerminal as any, { fit: vi.fn() } as any);

    useTerminalStore.getState().markNeedsReattach('t-failed');

    handleTerminalMessage(
      {
        type: 'terminal_attached',
        terminalId: 't-failed',
        success: false,
        error: 'Terminal not found',
      } as any,
      'test',
    );

    expect(fakeTerminal.writeln).toHaveBeenCalledWith(
      expect.stringContaining('Terminal attach failed'),
    );
    expect(useTerminalStore.getState().hasReattachFailed('t-failed')).toBe(true);
    // shouldReattach stays true so the component knows to fall back to mode='open' on next render
    expect(useTerminalStore.getState().shouldReattach('t-failed')).toBe(true);
  });

  it('5. terminal_output writes data to the xterm and marks ready', () => {
    const fakeTerminal = makeFakeTerminal();
    xtermRegistry.set('t-output', fakeTerminal as any, { fit: vi.fn() } as any);

    handleTerminalMessage(
      { type: 'terminal_output', terminalId: 't-output', data: 'shell-prompt$ ' } as any,
      'test',
    );

    expect(fakeTerminal.write).toHaveBeenCalledWith('shell-prompt$ ');
    expect(useTerminalStore.getState().isReady('t-output')).toBe(true);
  });

  it('7. mount with mode="open" still sends terminal_open while the backend is not yet ready', async () => {
    // Realistic startup window: facade has connected ws but backend.runtimeState is still 'starting'.
    // The current contract relies on facade.send queueing the message until the backend is ready,
    // so terminal_open must be emitted regardless of the gating signal.
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'backend-1', runtimeState: 'starting', name: 'Backend 1' }],
    } as any);

    render(<XTerminal terminalId="t-open" projectId="proj-1" />);
    await flushAttach();

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_open',
      terminalId: 't-open',
    }));
  });

  it('8. closing a popped-out terminal must dispose the main-window xterm instance', () => {
    // Pin the contract enforced by useTauriWindowEvents on terminal-window-closed:
    //   - registry entry is fully disposed (not just flagged)
    //   - shouldReattach is set so the next mount falls through mode='attach'
    const fakeTerminal = makeFakeTerminal();
    xtermRegistry.set('t-popout', fakeTerminal as any, { fit: vi.fn() } as any);

    // Simulate the side-effects of useTauriWindowEvents handler (full dispose, no markDetached)
    useTerminalStore.getState().removePoppedOutTerminal('t-popout');
    useTerminalStore.getState().markNeedsReattach('t-popout');
    xtermRegistry.delete('t-popout');

    expect(fakeTerminal.dispose).toHaveBeenCalled();
    expect(xtermRegistry.has('t-popout')).toBe(false);
    expect(useTerminalStore.getState().shouldReattach('t-popout')).toBe(true);
    expect(useTerminalStore.getState().isTerminalPoppedOut('t-popout')).toBe(false);
  });

  it('6. terminal_exited disposes registry entry and clears terminal mapping', () => {
    const fakeTerminal = makeFakeTerminal();
    xtermRegistry.set('t-exit', fakeTerminal as any, { fit: vi.fn() } as any);

    // Seed terminals map so we can observe its cleanup
    useTerminalStore.setState({
      terminals: { 'backend-1::proj-1': 't-exit' },
    } as any);

    handleTerminalMessage(
      { type: 'terminal_exited', terminalId: 't-exit', exitCode: 0 } as any,
      'test',
    );

    expect(fakeTerminal.write).toHaveBeenCalledWith(expect.stringContaining('Process exited with code 0'));
    expect(fakeTerminal.dispose).toHaveBeenCalled();
    expect(xtermRegistry.has('t-exit')).toBe(false);
    expect(useTerminalStore.getState().terminals['backend-1::proj-1']).toBeUndefined();
  });
});
