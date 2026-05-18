// server/src/application/conversation/handlers/__tests__/meta-workflow.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  handleCreateMetaWorkflowRun,
  handleSubmitMetaWorkflowRequirements,
  handleResolveMetaWorkflowRequirements,
  handleSetMetaWorkflowPhases,
  handleCancelMetaWorkflowRun,
  handleRunMetaWorkflowPhase,
  handleRerunMetaWorkflowPhase,
  handleIgnoreMetaWorkflowPhaseStale,
  handleEvaluateMetaWorkflowPhaseImpact,
  handleCascadeRerunMetaWorkflowPhase,
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
    expect(service.runPhase).toHaveBeenCalledWith('r1', 'p1');
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

  it('handleRerunMetaWorkflowPhase calls service.rerunPhase + broadcasts updated phase', async () => {
    const { client, sent } = makeClient();
    const service = {
      rerunPhase: vi.fn().mockResolvedValue({
        phase: { id: 'pr1', runId: 'r1', phaseId: 'p1', status: 'done', executeEntity: 'workflow',
                 phaseType: 'code-implement', attempt: 2, maxRetries: 3, createdAt: 0 },
        gateResults: [],
      }),
      getRun: vi.fn().mockReturnValue({ projectId: 'p' }),
    };
    await handleRerunMetaWorkflowPhase(client, {
      type: 'rerun_meta_workflow_phase', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(service.rerunPhase).toHaveBeenCalledWith('r1', 'p1');
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_phase_update', phase: { status: 'done' } });
  });

  it('handleIgnoreMetaWorkflowPhaseStale clears stale and broadcasts', () => {
    const { client, sent } = makeClient();
    const service = {
      ignoreStale: vi.fn().mockReturnValue({ id: 'pr1', status: 'done', executeEntity: 'workflow',
                                              runId: 'r1', phaseId: 'p1', phaseType: 'code-implement',
                                              attempt: 1, maxRetries: 3, createdAt: 0 }),
      getRun: vi.fn().mockReturnValue({ projectId: 'p' }),
    };
    handleIgnoreMetaWorkflowPhaseStale(client, {
      type: 'ignore_meta_workflow_phase_stale', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(service.ignoreStale).toHaveBeenCalledWith('r1', 'p1');
    expect(sent[0]).toMatchObject({ type: 'meta_workflow_phase_update' });
  });

  it('handleEvaluateMetaWorkflowPhaseImpact returns recommendation message', async () => {
    const { client, sent } = makeClient();
    const service = {
      evaluateImpact: vi.fn().mockResolvedValue({ kind: 'rerun', reason: 'changed' }),
    };
    await handleEvaluateMetaWorkflowPhaseImpact(client, {
      type: 'evaluate_meta_workflow_phase_impact', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(sent[0]).toMatchObject({
      type: 'meta_workflow_impact_recommendation',
      recommendation: { kind: 'rerun' },
    });
  });

  it('handleCascadeRerunMetaWorkflowPhase calls cascadeRerun and broadcasts each phase', async () => {
    const { client, sent } = makeClient();
    const service = {
      cascadeRerun: vi.fn().mockResolvedValue([
        { phase: { id: 'pr1', runId: 'r1', phaseId: 'p1', status: 'done', executeEntity: 'workflow',
                   phaseType: 'code-implement', attempt: 1, maxRetries: 3, createdAt: 0 }, gateResults: [] },
        { phase: { id: 'pr2', runId: 'r1', phaseId: 'p2', status: 'done', executeEntity: 'workflow',
                   phaseType: 'code-implement', attempt: 1, maxRetries: 3, createdAt: 0 }, gateResults: [] },
      ]),
      getRun: vi.fn().mockReturnValue({ projectId: 'p' }),
    };
    await handleCascadeRerunMetaWorkflowPhase(client, {
      type: 'cascade_rerun_meta_workflow_phase', runId: 'r1', phaseId: 'p1',
    }, service as never);
    expect(service.cascadeRerun).toHaveBeenCalledWith('r1', 'p1');
    expect(sent.length).toBe(2);
  });
});
