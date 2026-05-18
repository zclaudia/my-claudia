// server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleCreateMetaWorkflowRun,
  handleSubmitMetaWorkflowRequirements,
  handleResolveMetaWorkflowRequirements,
  handleSetMetaWorkflowPhases,
  handleCancelMetaWorkflowRun,
  handleRunMetaWorkflowPhase,
} from '../meta-workflow.js';

function makeClient() {
  const sent: unknown[] = [];
  return {
    sent,
    client: { ws: { send: (msg: string) => { sent.push(JSON.parse(msg)); } } } as never,
  };
}

describe('meta-workflow WS handlers', () => {
  it('handleCreateMetaWorkflowRun calls service.createRun + replies with run', () => {
    const { client, sent } = makeClient();
    const service = { createRun: vi.fn().mockReturnValue({ id: 'r1', status: 'requirement_draft', projectId: 'p', title: 't' }) };
    handleCreateMetaWorkflowRun(client, {
      type: 'create_meta_workflow_run', projectId: 'p', title: 't',
    }, service as never);
    expect(service.createRun).toHaveBeenCalledWith({ projectId: 'p', title: 't', description: undefined, defaultProviderId: undefined });
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_run_update', run: { id: 'r1' } });
  });

  it('handleSubmitMetaWorkflowRequirements calls service.submitRequirements', () => {
    const { client, sent } = makeClient();
    const service = { submitRequirements: vi.fn().mockReturnValue({ id: 'r1', status: 'requirement_review', projectId: 'p', title: 't' }) };
    handleSubmitMetaWorkflowRequirements(client, {
      type: 'submit_meta_workflow_requirements', runId: 'r1', requirementsPath: 'r.md',
    }, service as never);
    expect(service.submitRequirements).toHaveBeenCalledWith('r1', 'r.md');
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_run_update' });
  });

  it('handleResolveMetaWorkflowRequirements with approve calls approveRequirements', () => {
    const { client } = makeClient();
    const service = {
      approveRequirements: vi.fn().mockReturnValue({ id: 'r1', status: 'splitting', projectId: 'p', title: 't' }),
      rejectRequirements: vi.fn(),
    };
    handleResolveMetaWorkflowRequirements(client, {
      type: 'resolve_meta_workflow_requirements', runId: 'r1', decision: 'approve',
    }, service as never);
    expect(service.approveRequirements).toHaveBeenCalledWith('r1');
    expect(service.rejectRequirements).not.toHaveBeenCalled();
  });

  it('handleResolveMetaWorkflowRequirements with reject calls rejectRequirements', () => {
    const { client } = makeClient();
    const service = {
      approveRequirements: vi.fn(),
      rejectRequirements: vi.fn().mockReturnValue({ id: 'r1', status: 'requirement_draft', projectId: 'p', title: 't' }),
    };
    handleResolveMetaWorkflowRequirements(client, {
      type: 'resolve_meta_workflow_requirements', runId: 'r1', decision: 'reject',
    }, service as never);
    expect(service.rejectRequirements).toHaveBeenCalledWith('r1');
  });

  it('handleSetMetaWorkflowPhases passes phasesJson through', () => {
    const { client } = makeClient();
    const service = { setPhasesJson: vi.fn().mockReturnValue({ id: 'r1', status: 'executing', projectId: 'p', title: 't' }) };
    handleSetMetaWorkflowPhases(client, {
      type: 'set_meta_workflow_phases', runId: 'r1', phasesJson: '{}',
    }, service as never);
    expect(service.setPhasesJson).toHaveBeenCalledWith('r1', '{}');
  });

  it('handleCancelMetaWorkflowRun calls cancelRun', () => {
    const { client } = makeClient();
    const service = { cancelRun: vi.fn().mockReturnValue({ id: 'r1', status: 'cancelled', projectId: 'p', title: 't' }) };
    handleCancelMetaWorkflowRun(client, {
      type: 'cancel_meta_workflow_run', runId: 'r1',
    }, service as never);
    expect(service.cancelRun).toHaveBeenCalledWith('r1');
  });

  it('handleRunMetaWorkflowPhase awaits service.runPhase and broadcasts phase update', async () => {
    const { client, sent } = makeClient();
    const service = {
      runPhase: vi.fn().mockResolvedValue({
        phase: { id: 'pr1', runId: 'r1', phaseId: 'p1', status: 'done', executeEntity: 'workflow',
                 phaseType: 'code-implement', attempt: 1, maxRetries: 3, createdAt: 0 },
        gateResults: [],
      }),
      getRun: vi.fn().mockReturnValue({ id: 'r1', projectId: 'proj', title: 't', status: 'executing' }),
    };
    await handleRunMetaWorkflowPhase(client, {
      type: 'run_meta_workflow_phase', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(service.runPhase).toHaveBeenCalledWith('r1', 'p1', expect.any(String));
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_phase_update', phase: { id: 'pr1', status: 'done' } });
  });

  it('handlers reply with error message when service throws', () => {
    const { client, sent } = makeClient();
    const service = { createRun: vi.fn().mockImplementation(() => { throw new Error('boom'); }) };
    handleCreateMetaWorkflowRun(client, {
      type: 'create_meta_workflow_run', projectId: 'p', title: 't',
    }, service as never);
    expect(sent[0]).toMatchObject({ type: 'error', message: expect.stringMatching(/boom/) });
  });
});
