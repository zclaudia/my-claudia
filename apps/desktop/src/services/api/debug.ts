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
