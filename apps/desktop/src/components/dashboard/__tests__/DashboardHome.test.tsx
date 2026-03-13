import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DashboardHome } from '../DashboardHome';
import { useProjectStore } from '../../../stores/projectStore';
import { useSupervisionStore } from '../../../stores/supervisionStore';
import { useLocalPRStore } from '../../../stores/localPRStore';
import { useScheduledTaskStore } from '../../../stores/scheduledTaskStore';
import { useWorkflowStore } from '../../../stores/workflowStore';

describe('DashboardHome', () => {
  const projectId = 'p1';
  const onNavigate = vi.fn();

  beforeEach(() => {
    onNavigate.mockReset();
    useProjectStore.setState({
      projects: [{ id: projectId, name: 'Test Project', rootPath: '/tmp/test' }],
    } as any);
    useSupervisionStore.setState({ tasks: {}, agents: {}, lastCheckpoint: {} });
    useLocalPRStore.setState({ prs: {}, loadPRs: vi.fn().mockResolvedValue(undefined) } as any);
    useScheduledTaskStore.setState({ tasks: {}, loadTasks: vi.fn().mockResolvedValue(undefined) } as any);
    useWorkflowStore.setState({ workflows: {}, runs: {}, loadWorkflows: vi.fn().mockResolvedValue(undefined) } as any);
  });

  it('renders project name in header', () => {
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    expect(container.textContent).toContain('Test Project Dashboard');
  });

  it('renders summary cards', () => {
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    expect(container.textContent).toContain('Supervisor');
    expect(container.textContent).toContain('Tasks');
    expect(container.textContent).toContain('Local Pull Requests');
    expect(container.textContent).toContain('Scheduled');
    expect(container.textContent).toContain('Workflows');
  });

  it('shows empty state when no data', () => {
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    expect(container.textContent).toContain('No activity yet');
  });

  it('shows Not configured when no agent', () => {
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    expect(container.textContent).toContain('Not configured');
  });

  it('shows agent phase when agent exists', () => {
    useSupervisionStore.setState({
      tasks: {},
      agents: { [projectId]: { phase: 'active', mode: 'full' } },
      lastCheckpoint: {},
    } as any);
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    expect(container.textContent).toContain('Active');
    expect(container.textContent).toContain('Full Supervisor');
  });

  it('navigates to supervisor when supervisor card clicked', () => {
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    const buttons = container.querySelectorAll('button');
    const supervisorBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes('Supervisor'),
    );
    fireEvent.click(supervisorBtn!);
    expect(onNavigate).toHaveBeenCalledWith('supervisor');
  });

  it('navigates to tasks when tasks card clicked', () => {
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    const buttons = container.querySelectorAll('button');
    const tasksBtn = Array.from(buttons).find(
      (b) => b.textContent?.includes('Tasks') && !b.textContent?.includes('Scheduled'),
    );
    fireEvent.click(tasksBtn!);
    expect(onNavigate).toHaveBeenCalledWith('tasks');
  });

  it('shows active tasks count', () => {
    useSupervisionStore.setState({
      tasks: {
        [projectId]: [
          { id: 't1', status: 'running', title: 'Task 1', priority: 1 },
          { id: 't2', status: 'planning', title: 'Task 2', priority: 2 },
        ],
      },
      agents: {},
      lastCheckpoint: {},
    } as any);
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('active');
  });

  it('shows active PRs count', () => {
    useLocalPRStore.setState({
      prs: {
        [projectId]: [
          { id: 'pr1', status: 'open', title: 'PR 1', branchName: 'feat-1' },
          { id: 'pr2', status: 'merged', title: 'PR 2', branchName: 'feat-2' },
        ],
      },
      loadPRs: vi.fn().mockResolvedValue(undefined),
    } as any);
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    // 1 active PR (the merged one doesn't count)
    const buttons = container.querySelectorAll('button');
    const prBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes('Local Pull Requests'),
    );
    expect(prBtn!.textContent).toContain('1');
  });

  it('shows PR preview section for active PRs', () => {
    useLocalPRStore.setState({
      prs: {
        [projectId]: [
          { id: 'pr1', status: 'reviewing', title: 'My PR', branchName: 'feat-branch' },
        ],
      },
      loadPRs: vi.fn().mockResolvedValue(undefined),
    } as any);
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    expect(container.textContent).toContain('My PR');
    expect(container.textContent).toContain('feat-branch');
  });

  it('shows needs attention count for failed PRs', () => {
    useLocalPRStore.setState({
      prs: {
        [projectId]: [
          { id: 'pr1', status: 'review_failed', title: 'Bad PR', branchName: 'fix-1' },
        ],
      },
      loadPRs: vi.fn().mockResolvedValue(undefined),
    } as any);
    const { container } = render(
      <DashboardHome projectId={projectId} onNavigate={onNavigate} />,
    );
    expect(container.textContent).toContain('1 needs attention');
  });
});
