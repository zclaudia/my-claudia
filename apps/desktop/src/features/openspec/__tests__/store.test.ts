// apps/desktop/src/features/openspec/__tests__/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useOpenSpecStore } from '../store';
import { INITIAL_VIEW_STATE } from '../view-state';

describe('useOpenSpecStore', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {},
      specChangesById: {},
      executorsBySpecChange: {},
      corpusByProject: {},
      viewByProject: {},
    });
  });

  it('upsertIssue inserts new at front and replaces in-place on update', () => {
    const s = useOpenSpecStore.getState();
    s.upsertIssue({
      id: 'a',
      projectId: 'p1',
      title: 'A',
      status: 'open',
      priority: 'medium',
      labels: [],
      type: 'implement',
      isAnonymous: false,
      createdAt: 0,
      updatedAt: 0,
    } as never);
    s.upsertIssue({
      id: 'b',
      projectId: 'p1',
      title: 'B',
      status: 'open',
      priority: 'medium',
      labels: [],
      type: 'implement',
      isAnonymous: false,
      createdAt: 0,
      updatedAt: 0,
    } as never);
    expect(useOpenSpecStore.getState().issuesByProject.p1.map((i) => i.id)).toEqual(['b', 'a']);
    s.upsertIssue({
      id: 'a',
      projectId: 'p1',
      title: 'A2',
      status: 'planning',
      priority: 'medium',
      labels: [],
      type: 'implement',
      isAnonymous: false,
      createdAt: 0,
      updatedAt: 0,
    } as never);
    expect(useOpenSpecStore.getState().issuesByProject.p1.find((i) => i.id === 'a')!.status).toBe(
      'planning',
    );
  });

  it('upsertExecutor groups by specChangeId', () => {
    const s = useOpenSpecStore.getState();
    s.upsertExecutor({
      id: 'e1',
      projectId: 'p1',
      specChangeId: 'sc',
      type: 'manual',
      statusSummary: 'pending',
      createdAt: 0,
      updatedAt: 0,
    } as never);
    s.upsertExecutor({
      id: 'e2',
      projectId: 'p1',
      specChangeId: 'sc',
      type: 'manual',
      statusSummary: 'executing',
      createdAt: 0,
      updatedAt: 0,
    } as never);
    expect(
      useOpenSpecStore.getState().executorsBySpecChange.sc.map((e) => e.id),
    ).toEqual(['e1', 'e2']);
  });

  it('patchView seeds from INITIAL_VIEW_STATE on first patch', () => {
    const s = useOpenSpecStore.getState();
    s.patchView('p1', { screen: 'corpus' });
    const v = useOpenSpecStore.getState().viewByProject.p1;
    expect(v.screen).toBe('corpus');
    expect(v.anonymousExpanded).toBe(INITIAL_VIEW_STATE.anonymousExpanded);
    expect(v.activeArtifactTab).toBe('proposal');
  });

  it('clearProject removes project data', () => {
    const s = useOpenSpecStore.getState();
    s.setIssues('p1', [{ id: 'a' } as never]);
    s.patchView('p1', { screen: 'corpus' });
    s.clearProject('p1');
    expect(useOpenSpecStore.getState().issuesByProject.p1).toBeUndefined();
    expect(useOpenSpecStore.getState().viewByProject.p1).toBeUndefined();
  });
});
