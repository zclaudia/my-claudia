// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationWindow } from '../AutomationWindow';

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
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/api/projects')) {
        return ok([{ id: 'p1', name: 'Project 1' }]);
      }

      if (url.endsWith('/api/scheduled-tasks/global')) {
        return ok([]);
      }

      if (url.endsWith('/api/projects/p1/scheduled-tasks')) {
        return ok([]);
      }

      if (url.endsWith('/api/scheduled-task-templates')) {
        return ok([{ id: 'tpl1', name: 'Template 1' }]);
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
      expect(screen.getByText('Template 1')).toBeTruthy();
    });

    const automationCalls = mockFetch.mock.calls.filter(([input]) => String(input).endsWith('/api/automations'));
    const templateCalls = mockFetch.mock.calls.filter(([input]) => String(input).endsWith('/api/scheduled-task-templates'));

    expect(automationCalls).toHaveLength(1);
    expect(templateCalls).toHaveLength(1);
  });

  it('sends onceAt when creating a one-time automation', async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/api/projects')) return ok([{ id: 'p1', name: 'Project 1' }]);
      if (url.endsWith('/api/scheduled-tasks/global')) return ok([]);
      if (url.endsWith('/api/projects/p1/scheduled-tasks')) return ok([]);
      if (url.endsWith('/api/scheduled-task-templates')) return ok([]);
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
    fireEvent.change(selects[0], { target: { value: 'once' } });
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
