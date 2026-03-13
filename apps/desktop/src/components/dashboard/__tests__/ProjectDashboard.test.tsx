import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ProjectDashboard } from '../ProjectDashboard';
import { useSupervisionStore } from '../../../stores/supervisionStore';
import { useProjectStore } from '../../../stores/projectStore';

vi.mock('../../../services/api', () => ({
  getSupervisionAgent: vi.fn().mockResolvedValue(null),
  getSupervisionTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock('../DashboardHome', () => ({
  DashboardHome: (props: any) => (
    <div data-testid="dashboard-home">
      <button onClick={() => props.onNavigate('tasks')}>go-tasks</button>
      <button onClick={() => props.onNavigate('supervisor')}>go-supervisor</button>
      <button onClick={() => props.onNavigate('local-prs')}>go-local-prs</button>
      <button onClick={() => props.onNavigate('scheduled')}>go-scheduled</button>
      <button onClick={() => props.onNavigate('workflows')}>go-workflows</button>
    </div>
  ),
}));

vi.mock('../../supervision/AgentStatusBar', () => ({
  AgentStatusBar: (props: any) => <div data-testid="agent-status-bar" />,
}));

vi.mock('../../supervision/TaskBoard', () => ({
  TaskBoard: () => <div data-testid="task-board" />,
}));

vi.mock('../../supervision/ContextBrowser', () => ({
  ContextBrowser: () => <div data-testid="context-browser" />,
}));

vi.mock('../../supervision/CheckpointFeed', () => ({
  CheckpointFeed: () => <div data-testid="checkpoint-feed" />,
}));

vi.mock('../../chat/ChatInterface', () => ({
  ChatInterface: (props: any) => <div data-testid="chat-interface">{props.sessionId}</div>,
}));

vi.mock('../../local-prs/LocalPRsPanel', () => ({
  LocalPRsPanel: () => <div data-testid="local-prs-panel" />,
}));

vi.mock('../../scheduled-tasks/ScheduledTasksPanel', () => ({
  ScheduledTasksPanel: () => <div data-testid="scheduled-tasks-panel" />,
}));

vi.mock('../../workflows/WorkflowsPanel', () => ({
  WorkflowsPanel: () => <div data-testid="workflows-panel" />,
}));

describe('ProjectDashboard', () => {
  const projectId = 'p1';

  beforeEach(() => {
    useSupervisionStore.setState({ tasks: {}, agents: {}, lastCheckpoint: {} });
    useProjectStore.setState({
      projects: [{ id: projectId, name: 'Test', rootPath: '/tmp' }],
      dashboardViews: {},
      setDashboardView: vi.fn(),
    } as any);
  });

  it('renders agent status bar', () => {
    const { container } = render(<ProjectDashboard projectId={projectId} />);
    expect(container.querySelector('[data-testid="agent-status-bar"]')).toBeTruthy();
  });

  it('renders dashboard home by default', () => {
    const { container } = render(<ProjectDashboard projectId={projectId} />);
    expect(container.querySelector('[data-testid="dashboard-home"]')).toBeTruthy();
  });

  it('navigates to tasks view', () => {
    const { container, getByText } = render(
      <ProjectDashboard projectId={projectId} />,
    );
    fireEvent.click(getByText('go-tasks'));
    expect(container.querySelector('[data-testid="task-board"]')).toBeTruthy();
    // Back breadcrumb should show
    expect(container.textContent).toContain('Dashboard');
    expect(container.textContent).toContain('Tasks');
  });

  it('navigates to local-prs view', () => {
    const { container, getByText } = render(
      <ProjectDashboard projectId={projectId} />,
    );
    fireEvent.click(getByText('go-local-prs'));
    expect(container.querySelector('[data-testid="local-prs-panel"]')).toBeTruthy();
  });

  it('navigates to scheduled view', () => {
    const { container, getByText } = render(
      <ProjectDashboard projectId={projectId} />,
    );
    fireEvent.click(getByText('go-scheduled'));
    expect(container.querySelector('[data-testid="scheduled-tasks-panel"]')).toBeTruthy();
  });

  it('navigates to workflows view', () => {
    const { container, getByText } = render(
      <ProjectDashboard projectId={projectId} />,
    );
    fireEvent.click(getByText('go-workflows'));
    expect(container.querySelector('[data-testid="workflows-panel"]')).toBeTruthy();
  });

  it('navigates back to home from tasks view', () => {
    const { container, getByText } = render(
      <ProjectDashboard projectId={projectId} />,
    );
    fireEvent.click(getByText('go-tasks'));
    expect(container.querySelector('[data-testid="task-board"]')).toBeTruthy();
    // Click back button
    const backBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Dashboard') && b.querySelector('svg'),
    );
    if (backBtn) {
      fireEvent.click(backBtn);
      expect(container.querySelector('[data-testid="dashboard-home"]')).toBeTruthy();
    }
  });

  it('shows supervisor chat with session when agent has mainSessionId', () => {
    useSupervisionStore.setState({
      tasks: {},
      agents: { [projectId]: { phase: 'active', mainSessionId: 'sess-123' } },
      lastCheckpoint: {},
    } as any);
    const { container, getByText } = render(
      <ProjectDashboard projectId={projectId} />,
    );
    fireEvent.click(getByText('go-supervisor'));
    expect(container.querySelector('[data-testid="chat-interface"]')).toBeTruthy();
    expect(container.textContent).toContain('sess-123');
  });

  it('shows no supervisor message when no agent session', () => {
    const { container, getByText } = render(
      <ProjectDashboard projectId={projectId} />,
    );
    fireEvent.click(getByText('go-supervisor'));
    expect(container.textContent).toContain('No supervisor agent configured');
  });
});
