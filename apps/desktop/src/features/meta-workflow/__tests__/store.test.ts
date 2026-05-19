// apps/desktop/src/features/meta-workflow/__tests__/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useMetaWorkflowStore } from '../store.js';

describe('useMetaWorkflowStore — pending-select auto-promotion', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {},
      pendingSelectByProject: {},
    });
  });

  it('auto-selects the next-arriving run when project is flagged', () => {
    const s = useMetaWorkflowStore.getState();
    s.markPendingSelect('proj-1');
    s.upsertRun({
      id: 'run-new',
      projectId: 'proj-1',
      title: 'T',
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    } as never);
    const view = useMetaWorkflowStore.getState().viewByProject['proj-1'];
    expect(view.selectedRunId).toBe('run-new');
    expect(view.screen).toBe('requirements');
    expect(useMetaWorkflowStore.getState().pendingSelectByProject['proj-1']).toBeUndefined();
  });

  it('does nothing for upserts when no pending flag', () => {
    const s = useMetaWorkflowStore.getState();
    s.upsertRun({
      id: 'run-x',
      projectId: 'proj-1',
      title: 'T',
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    } as never);
    const view = useMetaWorkflowStore.getState().viewByProject['proj-1'];
    expect(view).toBeUndefined();
  });

  it('does not re-select on subsequent updates to the same run', () => {
    const s = useMetaWorkflowStore.getState();
    s.markPendingSelect('proj-1');
    s.upsertRun({
      id: 'run-new',
      projectId: 'proj-1',
      title: 'T',
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    } as never);
    // Manually change the selection away
    s.patchView('proj-1', { selectedRunId: undefined });
    // A status update for the same run must NOT re-select.
    s.upsertRun({
      id: 'run-new',
      projectId: 'proj-1',
      title: 'T',
      status: 'requirements-approved',
      createdAt: 1,
      updatedAt: 2,
    } as never);
    const view = useMetaWorkflowStore.getState().viewByProject['proj-1'];
    expect(view.selectedRunId).toBeUndefined();
  });
});
