// apps/desktop/src/features/openspec/api.ts
//
// REST helpers for the OpenSpec stack. Matches the convention used by other
// feature API modules (e.g. `features/meta-workflow/api.ts`): each helper
// calls `apiCall(path, options)` and unwraps the typed envelope returned by
// the corresponding G5a route.

import type {
  LocalIssue,
  LocalIssueStatus,
  LocalIssueType,
  LocalIssuePriority,
} from '@my-claudia/shared/features/local-issue';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import type { ExecutorInstance, ExecutorType } from '@my-claudia/shared/features/executor';
import type { Epic } from '@my-claudia/shared/features/epic';
import { apiCall } from '../../services/api/unwrap';

// ---------- Bootstrap types (inlined) ----------
//
// The shared package does not export the bootstrap types yet (see G6 follow-up),
// and the plan's deep relative path into `server/src/...` would couple the
// desktop bundle to server internals. Inlining a minimal mirror of the row
// shape is the pragmatic choice for G5b — fields match the server's
// `BootstrapScan` / `BootstrapReviewItem` row interfaces exactly.

export type BootstrapScanStatus =
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type InitPhase = 'discovering' | 'picking' | 'generating' | 'reviewing';

export interface BootstrapScan {
  id: string;
  projectId: string;
  status: BootstrapScanStatus;
  startedAt: number;
  finishedAt?: number;
  appliedCount: number;
  pendingCount: number;
  errorMessage?: string;
  initPhase?: InitPhase;
}

export type BootstrapReviewOp = 'modify' | 'remove';
export type BootstrapReviewStatus = 'pending' | 'approved' | 'rejected';

export interface BootstrapReviewItem {
  id: string;
  scanId: string;
  capability: string;
  operation: BootstrapReviewOp;
  /** For 'modify': serialized ParsedRequirement. For 'remove': { name: string }. */
  payloadJson: string;
  status: BootstrapReviewStatus;
  createdAt: number;
  resolvedAt?: number;
}

// ---------- Corpus ----------

export interface CapabilitySummary {
  capability: string;
  requirementCount: number;
  scenarioCount: number;
  lastUpdatedAt: number;
}

export interface CorpusDetail {
  capability: string;
  raw: string;
  parsed: unknown;
}

export async function listCorpus(projectId: string): Promise<CapabilitySummary[]> {
  const body = await apiCall<{ capabilities: CapabilitySummary[] }>(
    `/api/openspec/corpus?projectId=${encodeURIComponent(projectId)}`,
  );
  return body.capabilities;
}

export async function getCapability(projectId: string, capability: string): Promise<CorpusDetail> {
  return apiCall<CorpusDetail>(
    `/api/openspec/corpus/${encodeURIComponent(capability)}?projectId=${encodeURIComponent(projectId)}`,
  );
}

// ---------- SpecChange ----------

export async function listSpecChanges(projectId: string): Promise<SpecChange[]> {
  const body = await apiCall<{ specChanges: SpecChange[] }>(
    `/api/openspec/spec-changes?projectId=${encodeURIComponent(projectId)}`,
  );
  return body.specChanges;
}

export async function getSpecChange(id: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>(`/api/openspec/spec-changes/${id}`);
  return body.specChange;
}

// Artifact reads return raw text (not JSON) — bypass apiCall.
async function fetchText(path: string, label: string): Promise<string> {
  const res = await fetch(path, { credentials: 'include' });
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
  return res.text();
}

export function readProposal(id: string): Promise<string> {
  return fetchText(`/api/openspec/spec-changes/${id}/proposal`, 'readProposal');
}

export function readDesign(id: string): Promise<string> {
  return fetchText(`/api/openspec/spec-changes/${id}/design`, 'readDesign');
}

export function readTasks(id: string): Promise<string> {
  return fetchText(`/api/openspec/spec-changes/${id}/tasks`, 'readTasks');
}

export function readDeltaSpec(id: string, capability: string): Promise<string> {
  return fetchText(
    `/api/openspec/spec-changes/${id}/delta/${encodeURIComponent(capability)}`,
    'readDeltaSpec',
  );
}

export async function writeProposal(id: string, content: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>(
    `/api/openspec/spec-changes/${id}/proposal`,
    { method: 'PUT', body: JSON.stringify({ content }) },
  );
  return body.specChange;
}

export async function writeDesign(id: string, content: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>(
    `/api/openspec/spec-changes/${id}/design`,
    { method: 'PUT', body: JSON.stringify({ content }) },
  );
  return body.specChange;
}

export async function writeTasks(id: string, content: string): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>(
    `/api/openspec/spec-changes/${id}/tasks`,
    { method: 'PUT', body: JSON.stringify({ content }) },
  );
  return body.specChange;
}

export async function writeDeltaSpec(
  id: string,
  capability: string,
  content: string,
): Promise<SpecChange> {
  const body = await apiCall<{ specChange: SpecChange }>(
    `/api/openspec/spec-changes/${id}/delta/${encodeURIComponent(capability)}`,
    { method: 'PUT', body: JSON.stringify({ content }) },
  );
  return body.specChange;
}

// ---------- Executor ----------

export async function listExecutors(specChangeId: string): Promise<ExecutorInstance[]> {
  const body = await apiCall<{ executorInstances: ExecutorInstance[] }>(
    `/api/openspec/executor-instances?specChangeId=${encodeURIComponent(specChangeId)}`,
  );
  return body.executorInstances;
}

export interface CreateExecutorInput {
  projectId: string;
  specChangeId: string;
  type: ExecutorType;
  underlyingId?: string;
}

export async function createExecutor(input: CreateExecutorInput): Promise<ExecutorInstance> {
  const body = await apiCall<{ executorInstance: ExecutorInstance }>(
    '/api/openspec/executor-instances',
    { method: 'POST', body: JSON.stringify(input) },
  );
  return body.executorInstance;
}

async function executorAction(id: string, action: string): Promise<ExecutorInstance> {
  const body = await apiCall<{ executorInstance: ExecutorInstance }>(
    `/api/openspec/executor-instances/${id}/${action}`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.executorInstance;
}

export async function listLegacyClassicChangeIds(projectId: string): Promise<string[]> {
  const body = await apiCall<{ legacyIds: string[] }>(
    `/api/openspec/legacy-classic-change-ids?projectId=${encodeURIComponent(projectId)}`,
  );
  return body.legacyIds;
}

export async function listLegacyMetaWorkflowRunIds(projectId: string): Promise<string[]> {
  const body = await apiCall<{ legacyIds: string[] }>(
    `/api/openspec/legacy-meta-workflow-run-ids?projectId=${encodeURIComponent(projectId)}`,
  );
  return body.legacyIds;
}

export const startExecutor = (id: string): Promise<ExecutorInstance> => executorAction(id, 'start');
export const pauseExecutor = (id: string): Promise<ExecutorInstance> => executorAction(id, 'pause');
export const resumeExecutor = (id: string): Promise<ExecutorInstance> => executorAction(id, 'resume');
export const cancelExecutor = (id: string): Promise<ExecutorInstance> => executorAction(id, 'cancel');
export const completeExecutor = (id: string): Promise<ExecutorInstance> => executorAction(id, 'mark-completed');
export const refreshExecutor = (id: string): Promise<ExecutorInstance> => executorAction(id, 'refresh');

// ---------- Issues ----------

export interface CreateSubIssueInput {
  projectId: string;
  type: LocalIssueType;
  title: string;
  /** Optional Epic this issue rolls up into (C5). */
  epicId?: string;
  description?: string;
  priority?: LocalIssuePriority;
  labels?: string[];
  slug?: string;
}

export interface CreateEpicInput {
  projectId: string;
  title: string;
  description?: string;
  labels?: string[];
}

export async function createEpic(input: CreateEpicInput): Promise<Epic> {
  const body = await apiCall<{ epic: Epic }>('/api/epics', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.epic;
}

export async function listEpics(projectId: string): Promise<Epic[]> {
  const body = await apiCall<{ epics: Epic[] }>(
    `/api/epics?projectId=${encodeURIComponent(projectId)}`,
  );
  return body.epics;
}

export async function getEpic(id: string): Promise<Epic> {
  const body = await apiCall<{ epic: Epic }>(`/api/epics/${id}`);
  return body.epic;
}

export async function updateEpicStatus(id: string, status: Epic['status']): Promise<Epic> {
  const body = await apiCall<{ epic: Epic }>(`/api/epics/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return body.epic;
}

export async function listIssuesByEpic(epicId: string): Promise<LocalIssue[]> {
  const body = await apiCall<{ subIssues: LocalIssue[] }>(`/api/issues/${epicId}/sub-issues`);
  return body.subIssues;
}

export async function createSubIssue(
  input: CreateSubIssueInput,
): Promise<{ issue: LocalIssue; specChange: SpecChange }> {
  return apiCall<{ issue: LocalIssue; specChange: SpecChange }>('/api/issues/sub', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createAnonymous(input: {
  projectId: string;
  title: string;
}): Promise<{ issue: LocalIssue; specChange: SpecChange }> {
  return apiCall<{ issue: LocalIssue; specChange: SpecChange }>('/api/issues/anonymous', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getIssue(id: string): Promise<LocalIssue> {
  const body = await apiCall<{ issue: LocalIssue }>(`/api/issues/${id}`);
  return body.issue;
}

export async function listIssues(projectId: string): Promise<LocalIssue[]> {
  const body = await apiCall<{ issues: LocalIssue[] }>(
    `/api/issues?projectId=${encodeURIComponent(projectId)}`,
  );
  return body.issues;
}

export async function transitionStatus(id: string, status: LocalIssueStatus): Promise<LocalIssue> {
  const body = await apiCall<{ issue: LocalIssue }>(`/api/issues/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  return body.issue;
}

export interface ArchiveOutcome {
  ok: boolean;
  capabilities?: { capability: string; added: string[]; modified: string[]; removed: string[] }[];
  validationErrors?: { capability: string; issues: string[] }[];
  archivedDir?: string;
}

export async function closeAndArchive(
  id: string,
): Promise<{ issue: LocalIssue; archive?: ArchiveOutcome }> {
  return apiCall<{ issue: LocalIssue; archive?: ArchiveOutcome }>(
    `/api/issues/${id}/close-and-archive`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

// ---------- Bootstrap ----------

export interface StartBootstrapResult {
  scan: BootstrapScan;
  appliedSummary: Record<string, number>;
  pendingSummary: Record<string, { modified: number; removed: number }>;
}

export async function startBootstrap(
  projectId: string,
  mode: 'initial' | 'rescan',
): Promise<StartBootstrapResult> {
  return apiCall<StartBootstrapResult>('/api/openspec/bootstrap/scans', {
    method: 'POST',
    body: JSON.stringify({ projectId, mode }),
  });
}

export async function listBootstrapScans(projectId: string): Promise<BootstrapScan[]> {
  const body = await apiCall<{ scans: BootstrapScan[] }>(
    `/api/openspec/bootstrap/scans?projectId=${encodeURIComponent(projectId)}`,
  );
  return body.scans;
}

export async function getBootstrapScan(id: string): Promise<BootstrapScan> {
  const body = await apiCall<{ scan: BootstrapScan }>(`/api/openspec/bootstrap/scans/${id}`);
  return body.scan;
}

export async function listBootstrapItems(
  scanId: string,
  status: 'pending' | 'all' = 'all',
): Promise<BootstrapReviewItem[]> {
  const body = await apiCall<{ items: BootstrapReviewItem[] }>(
    `/api/openspec/bootstrap/scans/${scanId}/items?status=${status}`,
  );
  return body.items;
}

export async function approveBootstrapItem(itemId: string): Promise<BootstrapReviewItem> {
  const body = await apiCall<{ item: BootstrapReviewItem }>(
    `/api/openspec/bootstrap/items/${itemId}/approve`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.item;
}

export async function rejectBootstrapItem(itemId: string): Promise<BootstrapReviewItem> {
  const body = await apiCall<{ item: BootstrapReviewItem }>(
    `/api/openspec/bootstrap/items/${itemId}/reject`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.item;
}

export async function cancelBootstrapScan(scanId: string): Promise<BootstrapScan> {
  const body = await apiCall<{ scan: BootstrapScan }>(
    `/api/openspec/bootstrap/scans/${scanId}/cancel`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.scan;
}

export interface FinalizeBootstrapResult {
  scan: BootstrapScan;
  mergedSummary: Record<string, { modified: number; removed: number }>;
}

export async function finalizeBootstrap(scanId: string): Promise<FinalizeBootstrapResult> {
  return apiCall<FinalizeBootstrapResult>(
    `/api/openspec/bootstrap/scans/${scanId}/finalize`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

// ---------- AI Drafting (G7) ----------

export interface DraftResponse {
  specChange: SpecChange;
  content: string;
}

export async function draftProposal(specChangeId: string): Promise<DraftResponse> {
  return apiCall<DraftResponse>(
    `/api/openspec/spec-changes/${specChangeId}/draft-proposal`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function draftDesign(specChangeId: string): Promise<DraftResponse> {
  return apiCall<DraftResponse>(
    `/api/openspec/spec-changes/${specChangeId}/draft-design`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function draftTasks(specChangeId: string): Promise<DraftResponse> {
  return apiCall<DraftResponse>(
    `/api/openspec/spec-changes/${specChangeId}/draft-tasks`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function draftDelta(specChangeId: string, capability: string): Promise<DraftResponse> {
  return apiCall<DraftResponse>(
    `/api/openspec/spec-changes/${specChangeId}/draft-delta/${encodeURIComponent(capability)}`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

// ---------- Candidates (init flow) ----------

export type CandidatePhase =
  | 'discovered' | 'excluded' | 'generating' | 'generated' | 'approved' | 'rejected' | 'failed';

export type CandidateSource = 'ai_discovered' | 'user_added';

export interface Candidate {
  id: string;
  scanId: string;
  capability: string;
  title: string;
  description: string;
  source: CandidateSource;
  selected: boolean;
  phase: CandidatePhase;
  generated_md: string | null;
  generation_attempts: number;
  error_message: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function listBootstrapCandidates(scanId: string): Promise<Candidate[]> {
  const body = await apiCall<{ candidates: Candidate[] }>(
    `/api/openspec/bootstrap/scans/${scanId}/candidates`,
  );
  return body.candidates;
}

export async function addCandidate(scanId: string, input: { name: string; description: string }): Promise<Candidate> {
  const body = await apiCall<{ candidate: Candidate }>(
    `/api/openspec/bootstrap/scans/${scanId}/candidates`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return body.candidate;
}

export async function patchCandidate(id: string, patch: Partial<Pick<Candidate, 'title' | 'description' | 'selected'>>): Promise<Candidate> {
  const body = await apiCall<{ candidate: Candidate }>(
    `/api/openspec/bootstrap/candidates/${id}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return body.candidate;
}

export async function deleteCandidate(id: string): Promise<void> {
  await apiCall<{ ok: true }>(
    `/api/openspec/bootstrap/candidates/${id}`,
    { method: 'DELETE' },
  );
}

export async function commitGeneration(scanId: string): Promise<{ scan: BootstrapScan; candidates: Candidate[] }> {
  return apiCall<{ scan: BootstrapScan; candidates: Candidate[] }>(
    `/api/openspec/bootstrap/scans/${scanId}/generate`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function approveCandidate(id: string): Promise<Candidate> {
  const body = await apiCall<{ candidate: Candidate }>(
    `/api/openspec/bootstrap/candidates/${id}/approve`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.candidate;
}

export async function rejectCandidate(id: string): Promise<Candidate> {
  const body = await apiCall<{ candidate: Candidate }>(
    `/api/openspec/bootstrap/candidates/${id}/reject`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.candidate;
}

export async function retryCandidate(id: string): Promise<Candidate> {
  const body = await apiCall<{ candidate: Candidate }>(
    `/api/openspec/bootstrap/candidates/${id}/retry`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return body.candidate;
}
