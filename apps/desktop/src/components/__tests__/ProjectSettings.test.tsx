import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectSettings } from '../ProjectSettings';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSupervisionStore } from '../../stores/supervisionStore';

vi.mock('../../services/api', () => ({
  getProviders: vi.fn().mockResolvedValue([
    { id: 'prov-1', name: 'Claude', type: 'claude', isDefault: true },
    { id: 'prov-2', name: 'OpenAI', type: 'openai', isDefault: false },
  ]),
  updateProject: vi.fn().mockResolvedValue({}),
  getSupervisionAgent: vi.fn().mockResolvedValue(null),
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

const mockProject = {
  id: 'proj-1',
  name: 'Test Project',
  rootPath: '/home/user/test',
  providerId: 'prov-1',
  reviewProviderId: '',
  systemPrompt: 'Be helpful',
  isInternal: false,
  agentPermissionOverride: null,
};

describe('ProjectSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useServerStore.setState({
      connectionStatus: 'connected',
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

  it('renders the Project Settings modal', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Project Settings')).toBeTruthy();
  });

  it('renders all form fields', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Project Name *')).toBeTruthy();
    expect(screen.getByText('Working Directory')).toBeTruthy();
    expect(screen.getByText('Provider')).toBeTruthy();
    expect(screen.getByText('Review Provider')).toBeTruthy();
    expect(screen.getByText('System Prompt')).toBeTruthy();
    expect(screen.getByText('Agent Permission Override')).toBeTruthy();
  });

  it('populates form with project values', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    const nameInput = screen.getByDisplayValue('Test Project') as HTMLInputElement;
    expect(nameInput.value).toBe('Test Project');
    const rootPathInput = screen.getByDisplayValue('/home/user/test') as HTMLInputElement;
    expect(rootPathInput.value).toBe('/home/user/test');
    const systemPromptArea = screen.getByDisplayValue('Be helpful') as HTMLTextAreaElement;
    expect(systemPromptArea.value).toBe('Be helpful');
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ProjectSettings project={mockProject as any} isOpen={true} onClose={onClose} />
    );
    const backdrop = container.querySelector('.fixed.inset-0');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn();
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={onClose} />);
    // Find Close button (X button in header)
    const buttons = screen.getAllByRole('button');
    // First button is the close (X) button
    const closeBtn = buttons.find(b => b.querySelector('svg'));
    if (closeBtn) fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('updates name input', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    const nameInput = screen.getByDisplayValue('Test Project') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Project Name' } });
    expect(nameInput.value).toBe('New Project Name');
  });

  it('updates rootPath input', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    const rootPathInput = screen.getByDisplayValue('/home/user/test') as HTMLInputElement;
    fireEvent.change(rootPathInput, { target: { value: '/new/path' } });
    expect(rootPathInput.value).toBe('/new/path');
  });

  it('updates system prompt textarea', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    const textarea = screen.getByDisplayValue('Be helpful') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'New prompt' } });
    expect(textarea.value).toBe('New prompt');
  });

  it('calls api.updateProject and onClose when Save is clicked', async () => {
    const onClose = vi.fn();
    const api = await import('../../services/api');

    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={onClose} />);
    const saveBtn = screen.getByText('Save');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.updateProject).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ name: 'Test Project' })
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call api when name is empty', async () => {
    const api = await import('../../services/api');

    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    const nameInput = screen.getByDisplayValue('Test Project') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(api.updateProject).not.toHaveBeenCalled();
    });
  });

  it('toggles permission override on/off', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    // Find the toggle button for permission override
    const toggleBtns = screen.getAllByRole('button');
    const overrideToggle = toggleBtns.find(b =>
      b.className?.includes('rounded-full')
    );
    if (overrideToggle) {
      fireEvent.click(overrideToggle);
      // Now trust level section should be visible
      expect(screen.queryByText('Trust Level')).toBeTruthy();
    }
  });

  it('shows supervisor section', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Supervisor Agent')).toBeTruthy();
  });

  it('shows supervisor disabled message when supervisor not active', () => {
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Supervisor is not enabled for this project')).toBeTruthy();
  });

  it('shows active status when agent is active', () => {
    useSupervisionStore.setState({
      agents: {
        'proj-1': { id: 'agent-1', projectId: 'proj-1', phase: 'active' } as any,
      },
    } as any);

    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('calls initSupervisionAgent when supervisor toggle is clicked while disabled', async () => {
    const api = await import('../../services/api');

    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    // The supervisor toggle is a rounded-full button near the Supervisor Agent label
    const toggleButtons = screen.getAllByRole('button').filter(b =>
      b.className?.includes('rounded-full')
    );
    // Second rounded-full button is the supervisor toggle (first is permission override)
    if (toggleButtons.length >= 2) {
      fireEvent.click(toggleButtons[1]);
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

    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    const toggleButtons = screen.getAllByRole('button').filter(b =>
      b.className?.includes('rounded-full')
    );
    if (toggleButtons.length >= 2) {
      fireEvent.click(toggleButtons[1]);
    }

    await waitFor(() => {
      expect(api.updateSupervisionAgentAction).toHaveBeenCalledWith('proj-1', 'archive');
    });
  });

  it('shows Cancel button that calls onClose', () => {
    const onClose = vi.fn();
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders with project having permission override', () => {
    const projectWithOverride = {
      ...mockProject,
      agentPermissionOverride: { trustLevel: 'aggressive' },
    };

    render(<ProjectSettings project={projectWithOverride as any} isOpen={true} onClose={() => {}} />);
    // Trust level section should be visible since override is enabled
    expect(screen.getByText('Trust Level')).toBeTruthy();
  });

  it('shows disconnected state properly', () => {
    useServerStore.setState({ connectionStatus: 'disconnected' } as any);
    render(<ProjectSettings project={mockProject as any} isOpen={true} onClose={() => {}} />);
    // Component still renders but supervisor button may be disabled
    expect(screen.getByText('Project Settings')).toBeTruthy();
  });
});
