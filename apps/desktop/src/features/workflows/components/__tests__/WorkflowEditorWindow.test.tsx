import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { WorkflowEditorWindow } from '../WorkflowEditorWindow';
import { useServerStore } from '../../../../stores/serverStore';
import { useRecoveryStore } from '../../../../stores/recoveryStore';
import { useFacadeStore } from '../../../../stores/facadeStore';
import { useMobileRecoveryStore } from '../../../../stores/mobileRecoveryStore';
import { useProjectStore } from '../../../../stores/projectStore';
import * as api from '../../../../services/api';
import { isAndroid } from '../../../../utils/platform';

vi.mock('../WorkflowEditor', () => ({
  WorkflowEditor: (props: any) => (
    <div data-testid="workflow-editor">
      {props.projectId}|{props.standalone ? 'standalone' : 'embedded'}
    </div>
  ),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../../../services/api', () => ({
  getProjects: vi.fn().mockResolvedValue([]),
  getProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../utils/platform', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
  };
});

describe('WorkflowEditorWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    useServerStore.setState({
      activeServerId: 'backend-1',
      connections: {
        'backend-1': { status: 'connected', error: null, isLocalConnection: false, features: [] },
      },
    } as any);
    useRecoveryStore.setState({
      backends: {
        'backend-1': { status: 'ready' },
      },
    } as any);
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'backend-1', runtimeState: 'ready', name: 'Backend 1' }],
    } as any);
    useMobileRecoveryStore.getState().reset();
    useProjectStore.setState({
      setProjects: vi.fn(),
      setProviders: vi.fn(),
      selectProject: vi.fn(),
    } as any);
    vi.mocked(isAndroid).mockReturnValue(false);
  });

  it('renders WorkflowEditor when no workflowId (new workflow)', () => {
    const { container } = render(
      <WorkflowEditorWindow
        projectId="p1"
        serverUrl="http://localhost:3100"
        authToken="tok"
      />,
    );
    expect(container.textContent).toContain('p1');
    expect(container.textContent).toContain('standalone');
  });

  it('shows loading state when workflowId is provided', () => {
    // fetch never resolves so it stays loading
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <WorkflowEditorWindow
        projectId="p1"
        workflowId="w1"
        serverUrl="http://localhost:3100"
        authToken="tok"
      />,
    );
    // Loader2 is rendered (spinning icon), no editor content yet
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders editor after successful fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: 'w1', name: 'My Workflow', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } },
      }),
    });

    const { container } = render(
      <WorkflowEditorWindow
        projectId="p1"
        workflowId="w1"
        serverUrl="http://localhost:3100"
        authToken="tok"
      />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain('p1');
      expect(container.textContent).toContain('standalone');
    });
  });

  it('renders error state on fetch failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { container } = render(
      <WorkflowEditorWindow
        projectId="p1"
        workflowId="w1"
        serverUrl="http://localhost:3100"
        authToken="tok"
      />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain('HTTP 500');
      expect(container.textContent).toContain('Close Window');
    });
  });

  it('renders error when response has success: false', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: false,
        error: { message: 'Not found' },
      }),
    });

    const { container } = render(
      <WorkflowEditorWindow
        projectId="p1"
        workflowId="w1"
        serverUrl="http://localhost:3100"
        authToken="tok"
      />,
    );

    await waitFor(() => {
      expect(container.textContent).toContain('Not found');
    });
  });

  it('sends auth header in fetch request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'w1' } }),
    });

    render(
      <WorkflowEditorWindow
        projectId="p1"
        workflowId="w1"
        serverUrl="http://localhost:3100"
        authToken="my-token"
      />,
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/workflows/w1',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'my-token' }),
        }),
      );
    });
  });

  it('does not load workflow editor context on Android while mobile recovery is running', async () => {
    vi.mocked(isAndroid).mockReturnValue(true);
    useMobileRecoveryStore.setState({ phase: 'recovering' } as any);

    render(
      <WorkflowEditorWindow
        projectId="p1"
        serverUrl="http://localhost:3100"
        authToken="tok"
      />,
    );

    await Promise.resolve();

    expect(api.getProjects).not.toHaveBeenCalled();
    expect(api.getProviders).not.toHaveBeenCalled();
  });
});
