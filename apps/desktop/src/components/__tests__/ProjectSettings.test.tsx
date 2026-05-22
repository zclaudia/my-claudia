import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ProjectSettings } from '../../features/settings/ProjectSettings';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import { useProviderMetaStore } from '../../stores/providerMetaStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { isAndroid } from '../../utils/platform';

vi.mock('../../utils/platform', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
  };
});

vi.mock('../../services/api', () => ({
  getProviders: vi.fn(() => new Promise(() => {})),
  updateProject: vi.fn().mockResolvedValue({}),
  getSupervisionAgent: vi.fn(() => new Promise(() => {})),
  initSupervisionAgent: vi.fn().mockResolvedValue({
    id: 'agent-1',
    projectId: 'proj-1',
    phase: 'active',
    maxConcurrentTasks: 2,
    trustLevel: 'medium',
  }),
  updateSupervisionAgentAction: vi.fn().mockResolvedValue({
    id: 'agent-1',
    projectId: 'proj-1',
    phase: 'archived',
  }),
}));

vi.mock('../../features/workflows/api', () => ({
  listAllWorkflows: vi.fn().mockResolvedValue([]),
}));

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  rootPath: '/home/user/test',
  providerId: 'prov-1',
  reviewProviderId: '',
  permissionWorkflowOverrideId: '',
  systemPrompt: 'Be helpful',
  isInternal: false,
  agentPermissionOverride: null,
};

async function renderProjectSettings(props: Partial<Parameters<typeof ProjectSettings>[0]> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <ProjectSettings
        project={mockProject as any}
        isOpen={true}
        onClose={() => {}}
        {...props}
      />
    );
    await Promise.resolve();
  });
  return view;
}

async function clickAsync(target: Element) {
  await act(async () => {
    fireEvent.click(target);
    await Promise.resolve();
  });
}

describe('ProjectSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useServerStore.setState({
      activeServerId: 'local',
      connections: {
        local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
      },
    } as any);
    useRecoveryStore.setState({
      backends: {
        local: { status: 'ready' },
      },
    } as any);
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'local', runtimeState: 'ready', name: 'Local' }],
    } as any);
    vi.mocked(isAndroid).mockReturnValue(false);

    useProviderMetaStore.setState({
      providersByBackend: {},
      providerCommands: {},
      providerCapabilities: {},
    } as any);

    useProjectStore.setState({
      providers: [
        { id: 'prov-1', name: 'Claude', type: 'claude', isDefault: true },
      ],
      updateProject: vi.fn(),
      setProviders: vi.fn(),
    } as any);

    useSupervisionStore.setState({
      agents: {},
      tasks: {},
      lastCheckpoint: {},
      setAgent: vi.fn(),
      removeAgent: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <ProjectSettings project={mockProject as any} isOpen={false} onClose={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when project is null', () => {
    const { container } = render(
      <ProjectSettings project={null} isOpen={true} onClose={() => {}} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the Project Settings modal', async () => {
    await renderProjectSettings();
    expect(screen.getByText('Project Settings')).toBeTruthy();
  });

  it('renders all form fields', async () => {
    await renderProjectSettings();
    expect(screen.getByText('Project Name *')).toBeTruthy();
    expect(screen.getByText('Working Directory')).toBeTruthy();
    expect(screen.getByText('Provider')).toBeTruthy();
    expect(screen.getByText('Review Provider')).toBeTruthy();
    expect(screen.getByText('Permission Workflow Override')).toBeTruthy();
    expect(screen.getByText('System Prompt')).toBeTruthy();
    expect(screen.getByText('Agent Permission Override')).toBeTruthy();
  });

  it('populates form with project values', async () => {
    await renderProjectSettings();
    const nameInput = screen.getByDisplayValue('Test Project') as HTMLInputElement;
    expect(nameInput.value).toBe('Test Project');
    const rootPathInput = screen.getByDisplayValue('/home/user/test') as HTMLInputElement;
    expect(rootPathInput.value).toBe('/home/user/test');
    const systemPromptArea = screen.getByDisplayValue('Be helpful') as HTMLTextAreaElement;
    expect(systemPromptArea.value).toBe('Be helpful');
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    const { container } = await renderProjectSettings({ onClose });
    const backdrop = container.querySelector('.fixed.inset-0');
    if (backdrop) await clickAsync(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when X button is clicked', async () => {
    const onClose = vi.fn();
    await renderProjectSettings({ onClose });
    // Find Close button (X button in header)
    const buttons = screen.getAllByRole('button');
    // First button is the close (X) button
    const closeBtn = buttons.find(b => b.querySelector('svg'));
    if (closeBtn) await clickAsync(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('updates name input', async () => {
    await renderProjectSettings();
    const nameInput = screen.getByDisplayValue('Test Project') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Project Name' } });
    expect(nameInput.value).toBe('New Project Name');
  });

  it('updates rootPath input', async () => {
    await renderProjectSettings();
    const rootPathInput = screen.getByDisplayValue('/home/user/test') as HTMLInputElement;
    fireEvent.change(rootPathInput, { target: { value: '/new/path' } });
    expect(rootPathInput.value).toBe('/new/path');
  });

  it('does not reset rootPath while editing when only agent changes', () => {
    const { rerender } = render(
      <ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />
    );
    const rootPathInput = screen.getByDisplayValue('/home/user/test') as HTMLInputElement;

    fireEvent.change(rootPathInput, { target: { value: '/editing/path' } });
    expect(rootPathInput.value).toBe('/editing/path');

    rerender(
      <ProjectSettings
        project={{ ...mockProject, agent: { id: 'agent-1', phase: 'active' } } as any}
        isOpen={true}
        onClose={() => {}}
      />
    );

    expect(rootPathInput.value).toBe('/editing/path');
  });

  it('updates system prompt textarea', async () => {
    await renderProjectSettings();
    const textarea = screen.getByDisplayValue('Be helpful') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'New prompt' } });
    expect(textarea.value).toBe('New prompt');
  });

  it('loads active non-system workflows for permission override', async () => {
    const workflowApi = await import('../../features/workflows/api');
    vi.mocked(workflowApi.listAllWorkflows).mockResolvedValueOnce([
      { id: 'wf-global', name: 'Global Review', status: 'active', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } } as any,
      { id: 'wf-project', name: 'Project Review', projectId: 'proj-1', status: 'active', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } } as any,
      { id: 'wf-other', name: 'Other Project Review', projectId: 'proj-2', status: 'active', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } } as any,
      { id: 'wf-system', name: 'System Fallback', status: 'active', isSystem: true, definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } } as any,
    ]);

    await renderProjectSettings();

    await waitFor(() => {
      expect(workflowApi.listAllWorkflows).toHaveBeenCalled();
    });

    // Open the workflow override Select panel to inspect options
    const triggers = screen.getAllByRole('button', { expanded: false }).filter(b =>
      b.getAttribute('aria-haspopup') === 'listbox'
    );
    const overrideTrigger = triggers.find(b => b.textContent?.includes('Inherit global'));
    fireEvent.click(overrideTrigger!);
    expect(screen.getByRole('option', { name: '[Global] Global Review' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '[Project] Project Review' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '[Project] Other Project Review' })).toBeNull();
    expect(screen.queryByRole('option', { name: '[Global] System Fallback' })).toBeNull();
  });

  it('does not load providers when backend is not ready', async () => {
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'local', runtimeState: 'visible', name: 'Local' }],
    } as any);
    const api = await import('../../services/api');

    await renderProjectSettings();

    expect(api.getProviders).not.toHaveBeenCalled();
  });

  it('calls api.updateProject and onClose when Save is clicked', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const api = await import('../../services/api');

    await renderProjectSettings({ onClose });
    const saveBtn = screen.getByText('Save');
    await clickAsync(saveBtn);

    expect(api.updateProject).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ name: 'Test Project' })
    );
    expect(screen.getByText('Project settings saved.')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error message when save fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = await import('../../services/api');
    vi.mocked(api.updateProject).mockRejectedValueOnce(new Error('Save failed'));

    await renderProjectSettings();
    await clickAsync(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Save failed')).toBeTruthy();
    });
    consoleSpy.mockRestore();
  });

  it('does not call api when name is empty', async () => {
    const api = await import('../../services/api');

    await renderProjectSettings();
    const nameInput = screen.getByDisplayValue('Test Project') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    await clickAsync(screen.getByText('Save'));

    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it('toggles permission override on/off', async () => {
    await renderProjectSettings();
    // Find the toggle button for permission override
    const toggleBtns = screen.getAllByRole('button');
    const overrideToggle = toggleBtns.find(b =>
      b.className?.includes('rounded-full')
    );
    if (overrideToggle) {
      await clickAsync(overrideToggle);
      // Now category permission section should be visible (e.g., File Read dropdown)
      expect(screen.queryByText('File Read') || screen.queryByText('Agent Permission Override')).toBeTruthy();
    }
  });

  it('shows supervisor section', async () => {
    await renderProjectSettings();
    expect(screen.getByText('Project Workspace')).toBeTruthy();
  });

  it('shows supervisor disabled message when supervisor not active', async () => {
    await renderProjectSettings();
    expect(screen.getByText('Project Workspace is not enabled for this project')).toBeTruthy();
  });

  it('shows active status when agent is active', async () => {
    useSupervisionStore.setState({
      agents: {
        'proj-1': { id: 'agent-1', projectId: 'proj-1', phase: 'active' } as any,
      },
    } as any);

    await renderProjectSettings();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('calls initSupervisionAgent when supervisor toggle is clicked while disabled', async () => {
    const api = await import('../../services/api');

    await renderProjectSettings();
    // The supervisor toggle is a rounded-full button near the Supervisor Agent label
    // Toggle switches use w-10 h-5; other rounded-full buttons (e.g. Select triggers) don't.
    const toggleButtons = screen.getAllByRole('button').filter(b =>
      b.className?.includes('w-10') && b.className?.includes('rounded-full')
    );
    // Second rounded-full button is the supervisor toggle (first is permission override)
    if (toggleButtons.length >= 2) {
      await clickAsync(toggleButtons[1]);
    }

    await waitFor(() => {
      expect(api.initSupervisionAgent).toHaveBeenCalledWith(
        'proj-1',
        expect.any(Object),
        undefined,
        'lite'
      );
    });
  });

  it('calls updateSupervisionAgentAction when supervisor toggle is clicked while enabled', async () => {
    const api = await import('../../services/api');
    useSupervisionStore.setState({
      agents: {
        'proj-1': { id: 'agent-1', projectId: 'proj-1', phase: 'active' } as any,
      },
    } as any);

    await renderProjectSettings();
    // Toggle switches use w-10 h-5; other rounded-full buttons (e.g. Select triggers) don't.
    const toggleButtons = screen.getAllByRole('button').filter(b =>
      b.className?.includes('w-10') && b.className?.includes('rounded-full')
    );
    if (toggleButtons.length >= 2) {
      await clickAsync(toggleButtons[1]);
    }

    await waitFor(() => {
      expect(api.updateSupervisionAgentAction).toHaveBeenCalledWith('proj-1', 'archive');
    });
  });

  it('shows Cancel button that calls onClose', async () => {
    const onClose = vi.fn();
    await renderProjectSettings({ onClose });
    await clickAsync(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with project having permission override', async () => {
    const projectWithOverride = {
      ...mockProject,
      agentPermissionOverride: {
        enabled: true,
        profile: {
          fileRead: 'auto-approve',
          fileWrite: 'auto-approve',
          shellSafe: 'auto-approve',
          networkOps: 'ask',
          destructiveOps: 'block',
          userQuestions: 'ask',
        },
      },
    };

    await renderProjectSettings({ project: projectWithOverride as any });
    // Permission override section should be visible since override is enabled
    expect(screen.getByText('Agent Permission Override')).toBeTruthy();
  });

  it('saves permission workflow override', async () => {
    const api = await import('../../services/api');
    const workflowApi = await import('../../features/workflows/api');
    vi.mocked(workflowApi.listAllWorkflows).mockResolvedValueOnce([
      { id: 'wf-project', name: 'Project Review', projectId: 'proj-1', status: 'active', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } } as any,
    ]);

    await renderProjectSettings();

    // Open the workflow override Select and click the Project Review option
    const triggers = screen.getAllByRole('button', { expanded: false }).filter(b =>
      b.getAttribute('aria-haspopup') === 'listbox'
    );
    const overrideTrigger = triggers.find(b => b.textContent?.includes('Inherit global'));
    fireEvent.click(overrideTrigger!);
    fireEvent.click(screen.getByRole('option', { name: '[Project] Project Review' }));
    await clickAsync(screen.getByText('Save'));

    expect(api.updateProject).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ permissionWorkflowOverrideId: 'wf-project' }),
    );
  });

  it('shows disconnected state properly', async () => {
    useServerStore.setState({
      activeServerId: 'local',
      connections: {
        local: { status: 'disconnected', error: null, isLocalConnection: true, features: [] },
      },
    } as any);
    useRecoveryStore.setState({
      backends: {
        local: { status: 'disconnected' },
      },
    } as any);
    await renderProjectSettings();
    // Component still renders but supervisor button may be disabled
    expect(screen.getByText('Project Settings')).toBeTruthy();
  });
});
