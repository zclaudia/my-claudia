// server/src/application/conversation/handlers/meta-workflow.ts
import type {
  CreateMetaWorkflowRunMessage,
  SubmitMetaWorkflowRequirementsMessage,
  ResolveMetaWorkflowRequirementsMessage,
  SetMetaWorkflowPhasesMessage,
  CancelMetaWorkflowRunMessage,
  RunMetaWorkflowPhaseMessage,
} from '@my-claudia/shared/protocol/messages';
import type { ConnectedClient } from '../transport/types.js';
import type { MetaWorkflowService } from '../../../domains/meta-workflow/service.js';

function send(client: ConnectedClient, message: unknown): void {
  // matches existing handlers' use of sendMessage()
  client.ws.send(JSON.stringify(message));
}

function sendError(client: ConnectedClient, e: unknown): void {
  send(client, {
    type: 'error',
    message: e instanceof Error ? e.message : String(e),
  });
}

function broadcastRun(client: ConnectedClient, run: { projectId: string }): void {
  send(client, {
    type: 'meta_workflow_run_update',
    projectId: run.projectId,
    run,
  });
}

function broadcastPhase(
  client: ConnectedClient,
  projectId: string,
  runId: string,
  phase: unknown,
): void {
  send(client, {
    type: 'meta_workflow_phase_update',
    projectId,
    runId,
    phase,
  });
}

export function handleCreateMetaWorkflowRun(
  client: ConnectedClient,
  msg: CreateMetaWorkflowRunMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = service.createRun({
      projectId: msg.projectId,
      title: msg.title,
      description: msg.description,
      defaultProviderId: msg.defaultProviderId,
    });
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleSubmitMetaWorkflowRequirements(
  client: ConnectedClient,
  msg: SubmitMetaWorkflowRequirementsMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = service.submitRequirements(msg.runId, msg.requirementsPath);
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleResolveMetaWorkflowRequirements(
  client: ConnectedClient,
  msg: ResolveMetaWorkflowRequirementsMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = msg.decision === 'approve'
      ? service.approveRequirements(msg.runId)
      : service.rejectRequirements(msg.runId);
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleSetMetaWorkflowPhases(
  client: ConnectedClient,
  msg: SetMetaWorkflowPhasesMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = service.setPhasesJson(msg.runId, msg.phasesJson);
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export function handleCancelMetaWorkflowRun(
  client: ConnectedClient,
  msg: CancelMetaWorkflowRunMessage,
  service: MetaWorkflowService,
): void {
  try {
    const run = service.cancelRun(msg.runId);
    broadcastRun(client, run);
  } catch (e) {
    sendError(client, e);
  }
}

export async function handleRunMetaWorkflowPhase(
  client: ConnectedClient,
  msg: RunMetaWorkflowPhaseMessage,
  service: MetaWorkflowService,
): Promise<void> {
  try {
    const result = await service.runPhase(msg.runId, msg.phaseId);
    const run = service.getRun(msg.runId);
    if (!run) return;
    broadcastPhase(client, run.projectId, msg.runId, result.phase);
  } catch (e) {
    sendError(client, e);
  }
}
