// apps/desktop/src/features/meta-workflow/api.ts
import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
  ReusablePoolItem,
} from '@my-claudia/shared/features/meta-workflow';
import type {
  CreateMetaWorkflowRunMessage,
  SubmitMetaWorkflowRequirementsMessage,
  ResolveMetaWorkflowRequirementsMessage,
  SetMetaWorkflowPhasesMessage,
  CancelMetaWorkflowRunMessage,
  RunMetaWorkflowPhaseMessage,
  RerunMetaWorkflowPhaseMessage,
  IgnoreMetaWorkflowPhaseStaleMessage,
  EvaluateMetaWorkflowPhaseImpactMessage,
  CascadeRerunMetaWorkflowPhaseMessage,
} from '@my-claudia/shared/protocol/messages';
import { apiCall } from '../../services/api/unwrap';

// ── HTTP ────────────────────────────────────────────────────────

export async function listRuns(projectId: string): Promise<MetaWorkflowRun[]> {
  const res = await apiCall<{ runs: MetaWorkflowRun[] }>(
    `/api/meta-workflow/runs?projectId=${encodeURIComponent(projectId)}`,
  );
  return res.runs;
}

export async function getRun(runId: string): Promise<MetaWorkflowRun | null> {
  const res = await apiCall<{ run: MetaWorkflowRun }>(`/api/meta-workflow/runs/${runId}`);
  return res.run;
}

export async function listPhases(runId: string): Promise<MetaWorkflowPhase[]> {
  const res = await apiCall<{ phases: MetaWorkflowPhase[] }>(`/api/meta-workflow/runs/${runId}/phases`);
  return res.phases;
}

export async function promotePoolItem(
  runId: string,
  itemId: string,
  newTags: string[],
  newName?: string,
  newDescription?: string,
): Promise<ReusablePoolItem> {
  const res = await apiCall<{ item: ReusablePoolItem }>(
    `/api/meta-workflow/runs/${runId}/promote-item`,
    { method: 'POST', body: JSON.stringify({ itemId, newTags, newName, newDescription }) },
  );
  return res.item;
}

// ── WebSocket senders ───────────────────────────────────────────

type Sendable = { send: (msg: string) => void };

function sendMsg(socket: Sendable, msg: unknown): void {
  socket.send(JSON.stringify(msg));
}

export function sendCreateRun(socket: Sendable, msg: Omit<CreateMetaWorkflowRunMessage, 'type'>): void {
  sendMsg(socket, { type: 'create_meta_workflow_run', ...msg });
}
export function sendSubmitRequirements(socket: Sendable, msg: Omit<SubmitMetaWorkflowRequirementsMessage, 'type'>): void {
  sendMsg(socket, { type: 'submit_meta_workflow_requirements', ...msg });
}
export function sendResolveRequirements(socket: Sendable, msg: Omit<ResolveMetaWorkflowRequirementsMessage, 'type'>): void {
  sendMsg(socket, { type: 'resolve_meta_workflow_requirements', ...msg });
}
export function sendSetPhases(socket: Sendable, msg: Omit<SetMetaWorkflowPhasesMessage, 'type'>): void {
  sendMsg(socket, { type: 'set_meta_workflow_phases', ...msg });
}
export function sendCancelRun(socket: Sendable, msg: Omit<CancelMetaWorkflowRunMessage, 'type'>): void {
  sendMsg(socket, { type: 'cancel_meta_workflow_run', ...msg });
}
export function sendRunPhase(socket: Sendable, msg: Omit<RunMetaWorkflowPhaseMessage, 'type'>): void {
  sendMsg(socket, { type: 'run_meta_workflow_phase', ...msg });
}
export function sendRerunPhase(socket: Sendable, msg: Omit<RerunMetaWorkflowPhaseMessage, 'type'>): void {
  sendMsg(socket, { type: 'rerun_meta_workflow_phase', ...msg });
}
export function sendIgnoreStale(socket: Sendable, msg: Omit<IgnoreMetaWorkflowPhaseStaleMessage, 'type'>): void {
  sendMsg(socket, { type: 'ignore_meta_workflow_phase_stale', ...msg });
}
export function sendEvaluateImpact(socket: Sendable, msg: Omit<EvaluateMetaWorkflowPhaseImpactMessage, 'type'>): void {
  sendMsg(socket, { type: 'evaluate_meta_workflow_phase_impact', ...msg });
}
export function sendCascadeRerun(socket: Sendable, msg: Omit<CascadeRerunMetaWorkflowPhaseMessage, 'type'>): void {
  sendMsg(socket, { type: 'cascade_rerun_meta_workflow_phase', ...msg });
}
