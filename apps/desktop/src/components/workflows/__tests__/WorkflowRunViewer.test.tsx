import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { WorkflowRunViewer } from '../WorkflowRunViewer';
import { useWorkflowStore } from '../../../stores/workflowStore';

vi.mock('../../../services/api', () => ({
  getWorkflowRun: vi.fn().mockResolvedValue({ run: { id: 'run-1', workflowId: 'w1', status: 'pending', trigger: 'manual', startedAt: Date.now(), stepRuns: [] }, stepRuns: [] }),
  getWorkflowRuns: vi.fn().mockResolvedValue([]),
}));

describe('WorkflowRunViewer', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      runs: {},
    } as any);
  });

  it('renders the component', () => {
    const { container } = render(
      <WorkflowRunViewer runId="run-1" onBack={() => {}} />
    );
    expect(container.innerHTML).toBeTruthy();
  });

  it('renders run details when available', () => {
    useWorkflowStore.setState({
      runs: {
        'run-1': {
          id: 'run-1',
          workflowId: 'w1',
          status: 'completed',
          trigger: 'manual',
          startedAt: Date.now() - 5000,
          completedAt: Date.now(),
          stepRuns: [],
        },
      },
    } as any);
    const { container } = render(
      <WorkflowRunViewer runId="run-1" onBack={() => {}} />
    );
    expect(container.textContent).toContain('completed');
  });
});
