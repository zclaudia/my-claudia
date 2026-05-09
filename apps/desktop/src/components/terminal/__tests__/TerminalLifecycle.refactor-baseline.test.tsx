/**
 * Refactor baseline for terminal lifecycle behavior.
 *
 * Pins the *observable* contract of the controller-backed terminal subsystem:
 *
 *   1. Mount with mode='open'   → terminal_open is sent
 *   2. Mount with mode='attach' → terminal_attach is sent (no projectId)
 *   3. Cold-start (backend runtimeState='starting') still sends terminal_open
 *   4. Pop-out close path: useTauriWindowEvents-equivalent side effects must claim the
 *      controller (state moves toward attaching) and clear the popped-out flag.
 *
 * Per-message handler behavior (terminal_attached scrollback, terminal_output write, etc.)
 * is owned by TerminalController and verified in services/terminal/__tests__/TerminalController.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import { useTerminalStore } from '../../../stores/terminalStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { terminalRegistry } from '../../../services/terminal/TerminalRegistry';

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

// Real XTerminal — exercise the actual lifecycle effect
import { XTerminal } from '../XTerminal';

async function flushAttach() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  terminalRegistry.clear();

  useTerminalStore.setState({
    terminals: {},
    readyTerminals: new Set(),
    drawerOpen: {},
    ctrlActive: {},
    poppedOutTerminals: {},
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
  terminalRegistry.clear();
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
    const attachCall = mockSendMessage.mock.calls.find(
      (c) => c[0]?.type === 'terminal_attach' && c[0]?.terminalId === 't-attach'
    );
    expect(attachCall?.[0]?.projectId).toBeUndefined();
  });

  it('3. mount with mode="open" still sends terminal_open while the backend is not yet ready', async () => {
    // Cold-start: facade has connected ws but backend.runtimeState is still 'starting'.
    // facade.send buffers messages until the backend is ready, so terminal_open must
    // emit regardless of the gating signal.
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'backend-1', runtimeState: 'starting', name: 'Backend 1' }],
    } as any);

    render(<XTerminal terminalId="t-cold" projectId="proj-1" />);
    await flushAttach();

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'terminal_open',
      terminalId: 't-cold',
    }));
  });

  it('4. pop-out close path claims the controller and clears popped-out flag', async () => {
    // Bring a controller up to 'open' the way XTerminal mount would.
    render(<XTerminal terminalId="t-popout" projectId="proj-1" />);
    await flushAttach();

    const controller = terminalRegistry.get('t-popout');
    expect(controller).toBeDefined();
    controller!.handleServerMessage({
      type: 'terminal_opened', terminalId: 't-popout', success: true,
    } as any);
    expect(controller!.getState().kind).toBe('open');

    // Simulate pop-out: TerminalPanel.openTerminalInNewWindow calls release()
    useTerminalStore.getState().addPoppedOutTerminal('t-popout', 'window-1');
    controller!.release();
    expect(controller!.getState().kind).toBe('detached');
    expect(useTerminalStore.getState().isTerminalPoppedOut('t-popout')).toBe(true);

    // Simulate the standalone window closing → useTauriWindowEvents handler
    useTerminalStore.getState().removePoppedOutTerminal('t-popout');
    controller!.claim();

    expect(controller!.getState().kind).toBe('attaching');
    expect(useTerminalStore.getState().isTerminalPoppedOut('t-popout')).toBe(false);
  });
});
