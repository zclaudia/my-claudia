import { describe, it, expect, beforeEach } from 'vitest';
import { useMetaWorkflowStore } from '../store.js';

describe('useMetaWorkflowStore — layouts', () => {
  beforeEach(() => {
    useMetaWorkflowStore.setState({
      runs: {},
      phases: {},
      recommendations: {},
      viewByProject: {},
      pendingSelectByProject: {},
      layouts: {},
    });
  });

  it('setNodePosition stores per-run per-node coordinates', () => {
    const s = useMetaWorkflowStore.getState();
    s.setNodePosition('run-1', 'p1', { x: 100, y: 200 });
    s.setNodePosition('run-1', 'p2', { x: 50, y: 75 });
    s.setNodePosition('run-2', 'p1', { x: 0, y: 0 });
    const state = useMetaWorkflowStore.getState();
    expect(state.layouts['run-1']).toEqual({ p1: { x: 100, y: 200 }, p2: { x: 50, y: 75 } });
    expect(state.layouts['run-2']).toEqual({ p1: { x: 0, y: 0 } });
  });

  it('subsequent setNodePosition for same node overwrites', () => {
    const s = useMetaWorkflowStore.getState();
    s.setNodePosition('run-1', 'p1', { x: 10, y: 20 });
    s.setNodePosition('run-1', 'p1', { x: 30, y: 40 });
    expect(useMetaWorkflowStore.getState().layouts['run-1'].p1).toEqual({ x: 30, y: 40 });
  });
});
