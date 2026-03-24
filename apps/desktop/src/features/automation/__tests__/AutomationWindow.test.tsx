import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AutomationWindow } from '../AutomationWindow';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AutomationWindow', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith('/api/projects')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{ id: 'p1', name: 'Project 1' }] }),
        };
      }

      if (url.endsWith('/api/workflows')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{ id: 'w1', name: 'Build', status: 'active' }] }),
        };
      }

      if (url.endsWith('/api/workflow-templates')) {
        return {
          ok: true,
          json: async () => ({ success: true, data: [{ id: 'tpl1', name: 'Template 1' }] }),
        };
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  it('does not refetch workflows on every render', async () => {
    render(<AutomationWindow serverUrl="http://localhost:3100" authToken="" />);

    await waitFor(() => {
      expect(screen.getByText('Build')).toBeInTheDocument();
      expect(screen.getByText('Template 1')).toBeInTheDocument();
    });

    const workflowCalls = mockFetch.mock.calls.filter(([input]) => String(input).endsWith('/api/workflows'));
    const templateCalls = mockFetch.mock.calls.filter(([input]) => String(input).endsWith('/api/workflow-templates'));

    expect(workflowCalls).toHaveLength(1);
    expect(templateCalls).toHaveLength(1);
  });
});
