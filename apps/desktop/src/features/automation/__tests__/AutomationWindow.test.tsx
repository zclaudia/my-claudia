// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
      registryRevision: 0,
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

      if (url.endsWith('/api/automations')) {
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

    const automationCalls = mockFetch.mock.calls.filter(([input]) => String(input).endsWith('/api/automations'));
    expect(automationCalls).toHaveLength(1);
  });

  it('sends onceAt when creating a one-time automation', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/projects')) return ok([{ id: 'p1', name: 'Project 1' }]);
      if (url.endsWith('/api/automations') && init?.method === 'POST') return ok({ id: 'created' });
      if (url.endsWith('/api/automations')) return ok([]);

      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<AutomationWindow serverUrl="http://localhost:3100" authToken="" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0]);
    fireEvent.change(screen.getByPlaceholderText('Automation name'), { target: { value: 'One shot' } });

    const selects = screen.getAllByRole('combobox');
    const triggerSelect = selects.find((select) => within(select).queryByRole('option', { name: 'Once' }));
    expect(triggerSelect).toBeTruthy();
    fireEvent.change(triggerSelect as HTMLSelectElement, { target: { value: 'once' } });
    const onceInput = document.querySelector('input[type="datetime-local"]');
    expect(onceInput).not.toBeNull();
    fireEvent.change(onceInput as HTMLInputElement, { target: { value: '2026-03-25T09:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

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
