import { describe, it, expect } from 'vitest';
import type { ServerMessage } from '../../protocol/messages/index.js';
import type {
  MetaWorkflowRunUpdateMessage,
  MetaWorkflowPhaseUpdateMessage,
} from '../../protocol/messages/meta-workflow.js';

describe('meta-workflow protocol messages', () => {
  it('MetaWorkflowRunUpdateMessage is a valid ServerMessage', () => {
    const msg: MetaWorkflowRunUpdateMessage = {
      type: 'meta_workflow_run_update',
      projectId: 'proj-1',
      run: {
        id: 'run-1', projectId: 'proj-1', title: 't', status: 'requirement_draft',
        rejectCount: 0, createdAt: 0, updatedAt: 0,
      },
    };
    const asUnion: ServerMessage = msg;
    expect(asUnion.type).toBe('meta_workflow_run_update');
  });

  it('MetaWorkflowPhaseUpdateMessage carries the phase record', () => {
    const msg: MetaWorkflowPhaseUpdateMessage = {
      type: 'meta_workflow_phase_update',
      projectId: 'proj-1',
      runId: 'run-1',
      phase: {
        id: 'pr-1', runId: 'run-1', phaseId: 'p1',
        phaseType: 'code-implement', status: 'pending',
        executeEntity: 'workflow', attempt: 0, maxRetries: 3,
        createdAt: 0,
      },
    };
    expect(msg.type).toBe('meta_workflow_phase_update');
  });
});
