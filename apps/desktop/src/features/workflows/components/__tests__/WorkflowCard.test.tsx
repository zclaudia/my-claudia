import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WorkflowCard } from '../WorkflowCard';
import type { Workflow } from '@my-claudia/shared';

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'w1',
    projectId: 'p1',
    name: 'Test Workflow',
    status: 'active',
    definition: {
      triggers: [{ type: 'cron', cron: '0 * * * *' }],
      steps: [{ id: 's1', type: 'prompt', name: 'Step 1', config: {} }],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Workflow;
}

describe('WorkflowCard', () => {
  it('renders workflow name and description', () => {
    const wf = makeWorkflow({ description: 'A test workflow' });
    const { getByText } = render(
      <WorkflowCard workflow={wf} onViewRuns={() => {}} />
    );
    expect(getByText('Test Workflow')).toBeTruthy();
    expect(getByText('A test workflow')).toBeTruthy();
  });

  it('shows trigger label', () => {
    const wf = makeWorkflow();
    const { getByText } = render(
      <WorkflowCard workflow={wf} onViewRuns={() => {}} />
    );
    expect(getByText('cron: 0 * * * *')).toBeTruthy();
  });

  it('shows step count', () => {
    const wf = makeWorkflow();
    const { getByText } = render(
      <WorkflowCard workflow={wf} onViewRuns={() => {}} />
    );
    expect(getByText('1 step')).toBeTruthy();
  });

  it('calls onTrigger when run button clicked', () => {
    const onTrigger = vi.fn();
    const wf = makeWorkflow();
    const { container } = render(
      <WorkflowCard workflow={wf} onTrigger={onTrigger} onViewRuns={() => {}} />
    );
    const runButton = container.querySelector('button[title="Run now"]');
    if (runButton) fireEvent.click(runButton);
    expect(onTrigger).toHaveBeenCalled();
  });

  it('calls onEdit when edit button clicked', () => {
    const onEdit = vi.fn();
    const wf = makeWorkflow();
    const { container } = render(
      <WorkflowCard workflow={wf} onEdit={onEdit} onViewRuns={() => {}} />
    );
    const editButton = container.querySelector('button[title="Edit"]');
    if (editButton) fireEvent.click(editButton);
    expect(onEdit).toHaveBeenCalled();
  });

  it('shows inactive state for paused workflows', () => {
    const wf = makeWorkflow({ status: 'paused' });
    const { container } = render(
      <WorkflowCard workflow={wf} onViewRuns={() => {}} />
    );
    expect(container.innerHTML).toContain('opacity-60');
  });

  it('shows interval trigger label', () => {
    const wf = makeWorkflow({
      definition: {
        triggers: [{ type: 'interval', intervalMinutes: 30 }],
        steps: [],
      } as any,
    });
    const { getByText } = render(
      <WorkflowCard workflow={wf} onViewRuns={() => {}} />
    );
    expect(getByText('every 30min')).toBeTruthy();
  });

  it('shows event trigger label', () => {
    const wf = makeWorkflow({
      definition: {
        triggers: [{ type: 'event', event: 'run.completed' }],
        steps: [],
      } as any,
    });
    const { getByText } = render(
      <WorkflowCard workflow={wf} onViewRuns={() => {}} />
    );
    expect(getByText('event: run.completed')).toBeTruthy();
  });
});
