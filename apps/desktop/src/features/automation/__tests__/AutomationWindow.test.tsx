// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AutomationWindow dynamically imports `@tauri-apps/api/event` to listen for
// window-reuse navigation. In jsdom there is no `window.__TAURI_INTERNALS__`,
// so the real module's `listen()` rejects asynchronously and surfaces as an
// unhandled rejection that flips this suite to failed when run with the rest
// of the suites. Stub it here so the dynamic import resolves to a no-op.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
  TauriEvent: {},
}));

// Defense-in-depth: even if the `vi.mock` above is bypassed (e.g. another
// test in the same worker resets modules after this file is loaded), the
// real `listen()` only needs `__TAURI_INTERNALS__.{transformCallback, invoke}`
// to resolve without throwing. Stub a minimal shape so any leakage is silent.
vi.stubGlobal('__TAURI_INTERNALS__', {
  transformCallback: vi.fn(() => 'mock-callback-id'),
  invoke: vi.fn(() => Promise.resolve(0)),
  metadata: { currentWindow: { label: 'main' }, windows: {} },
});
vi.stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', {
  unregisterListener: vi.fn(),
});

import { AutomationWindow } from '../AutomationWindow';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useServerStore } from '../../../stores/serverStore';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
  return {
    ok: true,
    json: async () => ({ success: true, data }),
  };
}

describe('AutomationWindow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    useFacadeStore.setState({
      backends: [],
      localBackendId: null,
      connectionState: 'connected',
      currentInstanceId: null,
      currentDeviceId: null,
      mode: 'embedded',
      sessionStreams: {},
      snapshotVersion: 0,
    });
    useServerStore.setState({
      activeServerId: null,
      connections: {},
      localServerPort: 3100,
      controlPlaneMode: 'embedded-local',
    } as any);
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/api/projects')) {
        return ok([{ id: 'p1', name: 'Project 1' }]);
      }

      if (url.includes('/api/automations')) {
        return ok([{
          id: 'w1',
          name: 'Build',
          status: 'active',
          authoringMode: 'simple',
          definition: {
            nodes: [{ id: 'n1', type: 'shell' }],
            edges: [],
            entryNodeId: 'n1',
            triggers: [{ type: 'interval', intervalMinutes: 60 }],
          },
        }]);
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  it('does not refetch automations on every render', async () => {
    render(<AutomationWindow serverUrl="http://localhost:3100" authToken="" />);

    await waitFor(() => {
      expect(screen.getByText('Build')).toBeTruthy();
    });

    const automationCalls = mockFetch.mock.calls.filter(
      ([input]) => String(input).includes('/api/automations') && !(input as RequestInit | undefined)?.method,
    );
    // May fetch once (no project) or twice (once empty + once with projectId after projects load).
    // The key invariant is that it does NOT refetch on every render.
    expect(automationCalls.length).toBeGreaterThanOrEqual(1);
    expect(automationCalls.length).toBeLessThanOrEqual(2);
  });

  it('sends onceAt when creating a one-time automation', async () => {
    // Use empty projects to avoid AutomationsTab re-running its `refresh()`
    // effect once projects load (which briefly toggles `loading` and unmounts
    // the "New" button between user interactions, causing a hard-to-pin flake
    // in the full test suite).
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/projects')) return ok([]);
      if (url.includes('/api/automations') && init?.method === 'POST') return ok({ id: 'created' });
      if (url.includes('/api/automations')) return ok([]);

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AutomationWindow serverUrl="http://localhost:3100" authToken="" />);

    // findByRole polls until the loading state resolves and the button mounts.
    const newBtn = await screen.findByRole('button', { name: 'New' });
    fireEvent.click(newBtn);

    const nameInput = await screen.findByPlaceholderText('Automation name');
    fireEvent.change(nameInput, { target: { value: 'One shot' } });

    // Trigger Select is a button-based listbox; default value is "Interval"
    const triggerSelect = await waitFor(() => {
      const buttons = screen.getAllByRole('button').filter(b =>
        b.getAttribute('aria-haspopup') === 'listbox'
      );
      const found = buttons.find(b => b.textContent?.includes('Interval'));
      if (!found) throw new Error('trigger select not ready');
      return found;
    });
    fireEvent.click(triggerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Once' }));

    const onceInput = await waitFor(() => {
      const el = document.querySelector('input[type="datetime-local"]');
      if (!el) throw new Error('datetime input not ready');
      return el as HTMLInputElement;
    });
    fireEvent.change(onceInput, { target: { value: '2026-03-25T09:30' } });

    const createBtn = await screen.findByRole('button', { name: 'Create' });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/automations',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        }),
      );
    });

    const postCall = mockFetch.mock.calls.find((call) =>
      String(call[0]).endsWith('/api/automations') && (call[1] as RequestInit | undefined)?.method === 'POST'
    );
    const payload = JSON.parse(String((postCall?.[1] as RequestInit).body));
    expect(payload.trigger.type).toBe('once');
    expect(typeof payload.trigger.onceAt).toBe('number');
    expect(Number.isFinite(payload.trigger.onceAt)).toBe(true);
  });
});
