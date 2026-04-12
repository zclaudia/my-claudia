import { fetchLocalApi } from './base';

export interface CrashReportEntry {
  id: string;
  ts: number;
  process: 'server';
  event: 'uncaughtException' | 'startup_failure';
  version: string;
  pid: number;
  platform: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export type ManagedProcessSource =
  | 'provider_run'
  | 'background_task'
  | 'workspace_command'
  | 'test_run'
  | 'embedded_server'
  | 'mcp_server'
  | 'agent_tool'
  | 'unknown';

export type ManagedProcessStatus =
  | 'starting'
  | 'running'
  | 'exited'
  | 'failed'
  | 'killed'
  | 'orphaned';

export interface ManagedProcessRecord {
  processId: string;
  source: ManagedProcessSource;
  status: ManagedProcessStatus;
  pid: number | null;
  ppid: number | null;
  rootPid: number | null;
  pgid: number | null;
  command: string;
  args: string[];
  cwd: string | null;
  ownerSessionId: string | null;
  ownerTaskId: string | null;
  ownerBackendId: string | null;
  ownerRunId: string | null;
  ownerRequestId: string | null;
  parentProcessId: string | null;
  childPids: number[];
  childCount: number;
  startedAt: number;
  exitedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  protected: boolean;
  tags: string[];
  adopted: boolean;
  orphanedAt: number | null;
  metadata: Record<string, unknown> | null;
}

export async function getCrashReports(): Promise<{ reports: CrashReportEntry[]; filePath: string }> {
  const result = await fetchLocalApi<{ reports: CrashReportEntry[]; filePath: string }>('/api/debug/crashes');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch crash reports');
  }
  return result.data;
}

export async function getManagedProcesses(): Promise<ManagedProcessRecord[]> {
  const result = await fetchLocalApi<ManagedProcessRecord[]>('/api/debug/processes');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch managed processes');
  }
  return result.data;
}

export interface PermissionLogEntry {
  id: string;
  session_id: string;
  tool: string;
  detail: string;
  decision: 'allow' | 'deny';
  remembered: number;
  created_at: number;
}

export interface PermissionLogsResponse {
  entries: PermissionLogEntry[];
  total: number;
}

export async function getPermissionLogs(params?: {
  limit?: number;
  offset?: number;
  session_id?: string;
  decision?: string;
}): Promise<PermissionLogsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.session_id) searchParams.set('session_id', params.session_id);
  if (params?.decision) searchParams.set('decision', params.decision);
  const qs = searchParams.toString();
  const path = `/api/debug/permission-logs${qs ? '?' + qs : ''}`;
  const result = await fetchLocalApi<PermissionLogsResponse>(path);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch permission logs');
  }
  return result.data;
}

export interface SimulateAIReviewRequest {
  toolName: string;
  toolInput: unknown;
  detail: string;
  cwd: string;
  providerId?: string;
  confidenceThreshold?: number;
  mode?: 'quick' | 'full';
}

export interface SimulateAIReviewResponse {
  decision: 'approve' | 'deny' | 'uncertain';
  reasoning: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  durationMs: number;
  providerId: string;
  providerType: string;
  mode: 'quick' | 'full';
}

export async function simulateAIReview(req: SimulateAIReviewRequest): Promise<SimulateAIReviewResponse> {
  const result = await fetchLocalApi<SimulateAIReviewResponse>('/api/debug/simulate-ai-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'AI review simulation failed');
  }
  return result.data;
}
