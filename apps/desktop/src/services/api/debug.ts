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

export async function getCrashReports(): Promise<{ reports: CrashReportEntry[]; filePath: string }> {
  const result = await fetchLocalApi<{ reports: CrashReportEntry[]; filePath: string }>('/api/debug/crashes');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch crash reports');
  }
  return result.data;
}
