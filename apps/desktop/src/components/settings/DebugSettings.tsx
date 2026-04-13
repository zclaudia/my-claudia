import { useState, useEffect, useCallback } from 'react';
import { useProcessMonitorStore } from '../../stores/processMonitorStore';
import * as api from '../../services/api';
import { exportLogs, getLogCount, clearLogs } from '../../services/logger';
import { isTauri } from '../../utils/platform';
import type { CrashReportEntry, ManagedProcessRecord, PermissionLogEntry, SimulateAIReviewResponse } from '../../services/api/debug';
import type { ClientMessage, ProviderConfig } from '@my-claudia/shared';

interface DebugSettingsProps {
  isConnected: boolean;
  sendMessage: (msg: ClientMessage) => void;
  embeddedServerStatus: string;
}

export function DebugSettings({ isConnected, sendMessage, embeddedServerStatus }: DebugSettingsProps) {
  const [leakCleanupRunning, setLeakCleanupRunning] = useState(false);
  const [leakCleanupResult, setLeakCleanupResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [crashReports, setCrashReports] = useState<CrashReportEntry[]>([]);
  const [crashReportsPath, setCrashReportsPath] = useState<string | null>(null);
  const [crashReportsLoading, setCrashReportsLoading] = useState(false);
  const [crashReportsError, setCrashReportsError] = useState<string | null>(null);
  const [managedProcesses, setManagedProcesses] = useState<ManagedProcessRecord[]>([]);
  const [managedProcessesLoading, setManagedProcessesLoading] = useState(false);
  const [managedProcessesError, setManagedProcessesError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [permLogs, setPermLogs] = useState<PermissionLogEntry[]>([]);
  const [permLogsTotal, setPermLogsTotal] = useState(0);
  const [permLogsLoading, setPermLogsLoading] = useState(false);
  const [permLogsError, setPermLogsError] = useState<string | null>(null);
  const [permLogsFilter, setPermLogsFilter] = useState<string>('');
  const PERM_LOGS_LIMIT = 20;

  // AI Review Simulator state
  const [simToolName, setSimToolName] = useState('Bash');
  const [simDetail, setSimDetail] = useState('');
  const [simCwd, setSimCwd] = useState('');
  const [simProviderId, setSimProviderId] = useState('');
  const [simThreshold, setSimThreshold] = useState(0.8);
  const [simMode, setSimMode] = useState<'quick' | 'full' | 'runtime' | 'workflow'>('quick');
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<SimulateAIReviewResponse | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [simProviders, setSimProviders] = useState<ProviderConfig[]>([]);

  const cleanupResult = useProcessMonitorStore((state) => state.lastCleanupResult);
  const clearCleanupResult = useProcessMonitorStore((state) => state.clearCleanupResult);

  // --- Callbacks ---

  const loadCrashReports = useCallback(async () => {
    setCrashReportsLoading(true);
    setCrashReportsError(null);
    try {
      const result = await api.getCrashReports();
      setCrashReports(result.reports);
      setCrashReportsPath(result.filePath);
    } catch (err) {
      setCrashReports([]);
      setCrashReportsPath(null);
      setCrashReportsError(err instanceof Error ? err.message : 'Failed to load crash reports');
    } finally {
      setCrashReportsLoading(false);
    }
  }, []);

  const handleLeakCleanup = useCallback(() => {
    if (!isConnected) {
      setLeakCleanupResult({ ok: false, message: 'Connect to the server before running process cleanup.' });
      return;
    }
    setLeakCleanupRunning(true);
    clearCleanupResult();
    setLeakCleanupResult(null);
    try {
      sendMessage({ type: 'kill_leaked_processes' } as ClientMessage);
    } catch (err) {
      setLeakCleanupResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to request process cleanup.',
      });
      setLeakCleanupRunning(false);
    }
  }, [clearCleanupResult, isConnected, sendMessage]);

  const handleRefreshProcesses = useCallback(async () => {
    setManagedProcessesLoading(true);
    try {
      const records = await api.getManagedProcesses();
      setManagedProcesses(records);
      setManagedProcessesError(null);
    } catch (err) {
      setManagedProcessesError(err instanceof Error ? err.message : 'Failed to load managed processes');
    } finally {
      setManagedProcessesLoading(false);
    }
  }, []);

  const handleCopyJSON = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(crashReports, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[Settings] Failed to copy crash reports:', err);
    }
  }, [crashReports]);

  const handleExportLogs = useCallback(async () => {
    try {
      const logs = exportLogs();
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `my-claudia-logs-${ts}.json`;
      const blob = new Blob([logs], { type: 'application/json' });

      if (isTauri()) {
        const { downloadDir } = await import('@tauri-apps/api/path');
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        const dir = await downloadDir();
        const filePath = `${dir}/${fileName}`;
        await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
        if (!navigator.userAgent.includes('Android')) {
          const { open } = await import('@tauri-apps/plugin-shell');
          await open(dir);
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('[Settings] Failed to export logs:', err);
    }
  }, []);

  const loadPermissionLogs = useCallback(async (offset = 0, decision?: string) => {
    setPermLogsLoading(true);
    setPermLogsError(null);
    try {
      const result = await api.getPermissionLogs({
        limit: PERM_LOGS_LIMIT,
        offset,
        decision: decision || undefined,
      });
      setPermLogs(offset === 0 ? result.entries : (prev) => [...prev, ...result.entries]);
      setPermLogsTotal(result.total);
    } catch (err) {
      setPermLogsError(err instanceof Error ? err.message : 'Failed to load permission logs');
    } finally {
      setPermLogsLoading(false);
    }
  }, []);

  const handleRunSimulation = useCallback(async () => {
    setSimRunning(true);
    setSimError(null);
    setSimResult(null);
    try {
      const result = await api.simulateAIReview({
        toolName: simToolName,
        toolInput: simToolName === 'Bash' ? { command: simDetail } : { content: simDetail },
        detail: simDetail,
        cwd: simCwd,
        providerId: simProviderId || undefined,
        confidenceThreshold: simThreshold,
        mode: simMode,
      });
      setSimResult(result);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setSimRunning(false);
    }
  }, [simToolName, simDetail, simCwd, simProviderId, simThreshold, simMode]);

  // --- Effects ---

  useEffect(() => {
    if (!cleanupResult) return;
    setLeakCleanupRunning(false);

    if (cleanupResult.status === 'skipped_active_runs') {
      setLeakCleanupResult({
        ok: false,
        message: `Cleanup skipped because ${cleanupResult.activeRunCount} active run(s) are still in progress.`,
      });
      return;
    }

    if (cleanupResult.status === 'clean') {
      setLeakCleanupResult({
        ok: true,
        message: 'Cleanup completed. No leaked child processes were found.',
      });
      return;
    }

    setLeakCleanupResult({
      ok: cleanupResult.killedCount > 0,
      message: cleanupResult.killedCount > 0
        ? `Cleanup completed. Terminated ${cleanupResult.killedCount} of ${cleanupResult.leakedCount} leaked process(es).`
        : `Cleanup completed, but none of the ${cleanupResult.leakedCount} leaked process(es) could be terminated.`,
    });
  }, [cleanupResult]);

  // Auto-load crash reports on mount
  useEffect(() => {
    if (embeddedServerStatus === 'disabled') return;
    void loadCrashReports();
  }, [embeddedServerStatus, loadCrashReports]);

  // Auto-load managed processes on mount + poll every 5s
  useEffect(() => {
    if (embeddedServerStatus === 'disabled') return;

    let cancelled = false;

    const pollManagedProcesses = async () => {
      try {
        const records = await api.getManagedProcesses();
        if (!cancelled) {
          setManagedProcesses((prev) => {
            if (prev.length === records.length && prev.every((p, i) => p.processId === records[i].processId && p.status === records[i].status)) {
              return prev;
            }
            return records;
          });
          setManagedProcessesError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setManagedProcessesError(err instanceof Error ? err.message : 'Failed to load managed processes');
        }
      }
    };

    void pollManagedProcesses();

    const interval = setInterval(() => {
      void pollManagedProcesses();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [embeddedServerStatus]);

  // Auto-load permission logs on mount
  useEffect(() => {
    void loadPermissionLogs(0, permLogsFilter);
  }, [loadPermissionLogs, permLogsFilter]);

  // Load providers for AI Review Simulator
  useEffect(() => {
    api.getProviders()
      .then((providers) => {
        const reviewCapable = providers.filter((p) =>
          ['claude', 'kimi', 'cursor', 'opencode', 'codex'].includes(p.type)
        );
        setSimProviders(reviewCapable);
        if (reviewCapable.length > 0 && !simProviderId) {
          setSimProviderId(reviewCapable[0].id);
        }
      })
      .catch(() => { /* ignore */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Render ---

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Debug</h3>
      <p className="text-sm text-muted-foreground">
        Diagnostics and troubleshooting tools.
      </p>

      <div className="space-y-3">
        {/* Crash Reports */}
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm">Crash Reports</div>
              <div className="text-xs text-muted-foreground">
                Recent embedded server fatal crashes stored on disk.
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { void loadCrashReports(); }}
                disabled={crashReportsLoading || embeddedServerStatus === 'disabled'}
                className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground text-secondary-foreground rounded-lg transition-colors"
              >
                {crashReportsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                onClick={() => { void handleCopyJSON(); }}
                disabled={crashReports.length === 0}
                className="px-2 py-1 text-xs bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-lg transition-colors"
              >
                {copied ? 'Copied!' : 'Copy JSON'}
              </button>
            </div>
          </div>
          {crashReportsPath && (
            <div className="text-[11px] text-muted-foreground break-all">
              {crashReportsPath}
            </div>
          )}
          {crashReportsError && (
            <div className="text-xs text-destructive">{crashReportsError}</div>
          )}
          {!crashReportsError && crashReports.length === 0 && !crashReportsLoading && (
            <div className="text-xs text-muted-foreground">No crash reports recorded.</div>
          )}
          {crashReports.length > 0 && (
            <div className="space-y-2">
              {crashReports.map((report) => (
                <div key={report.id} className="p-3 bg-background/70 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium">{report.event}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(report.ts).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-xs break-words">{report.message}</div>
                  <div className="text-[11px] text-muted-foreground">
                    v{report.version} • pid {report.pid} • {report.platform}
                  </div>
                  {report.stack && (
                    <pre className="mt-2 max-h-32 overflow-auto rounded bg-card px-2 py-1.5 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                      {report.stack}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Client Logs */}
        <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">Client Logs</div>
              <div className="text-xs text-muted-foreground">{getLogCount()} entries in buffer</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { clearLogs(); }}
                className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-lg transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => { void handleExportLogs(); }}
                className="px-3 py-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
              >
                Export Logs
              </button>
            </div>
          </div>
        </div>

        {/* Managed Processes */}
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm">Managed Processes</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Read-only process registry for product-owned commands and adopted roots.
              </div>
            </div>
            <button
              onClick={() => { void handleRefreshProcesses(); }}
              disabled={managedProcessesLoading || embeddedServerStatus === 'disabled'}
              className="px-3 py-1 text-xs bg-secondary hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground text-secondary-foreground rounded-lg font-medium transition-colors"
            >
              {managedProcessesLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {managedProcessesError && (
            <div className="text-xs text-destructive">{managedProcessesError}</div>
          )}
          {!managedProcessesError && managedProcesses.length === 0 && !managedProcessesLoading && (
            <div className="text-xs text-muted-foreground">No managed processes recorded yet.</div>
          )}
          {managedProcesses.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-auto">
              {managedProcesses.map((process) => (
                <div key={process.processId} className="p-3 bg-background/70 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-medium break-all">
                      {process.command} {process.args.join(' ')}
                    </div>
                    <div className="text-[11px] text-muted-foreground uppercase">
                      {process.status}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span>{process.source}</span>
                    <span>pid {process.rootPid ?? process.pid ?? 'n/a'}</span>
                    <span>{process.childCount} {process.childCount === 1 ? 'child' : 'children'}</span>
                    {process.adopted && <span>adopted</span>}
                    {process.tags.length > 0 && <span>{process.tags.join(', ')}</span>}
                  </div>
                  {process.cwd && (
                    <div className="text-[11px] text-muted-foreground break-all">
                      cwd: {process.cwd}
                    </div>
                  )}
                  {(process.ownerSessionId || process.ownerTaskId) && (
                    <div className="text-[11px] text-muted-foreground break-all">
                      owner: {process.ownerSessionId ? `session ${process.ownerSessionId}` : ''}
                      {process.ownerSessionId && process.ownerTaskId ? ' • ' : ''}
                      {process.ownerTaskId ? `task ${process.ownerTaskId}` : ''}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    started {new Date(process.startedAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Leaked Process Cleanup */}
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          <div>
            <div className="text-sm">Leaked Process Cleanup</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Trigger an immediate server-side scan for orphaned provider child processes and terminate any matches.
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {isConnected ? 'Connected to active server' : 'Server disconnected'}
            </div>
            <button
              onClick={handleLeakCleanup}
              disabled={leakCleanupRunning || !isConnected}
              className="px-3 py-1 text-xs bg-destructive hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground text-destructive-foreground rounded-lg font-medium transition-colors"
            >
              {leakCleanupRunning ? 'Cleaning…' : 'Clean Leaked Processes'}
            </button>
          </div>
          {leakCleanupResult && (
            <div className={`text-xs ${leakCleanupResult.ok ? 'text-success' : 'text-destructive'}`}>
              {leakCleanupResult.message}
            </div>
          )}
        </div>

        {/* Permission Logs */}
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm">Permission Logs</div>
              <div className="text-xs text-muted-foreground">
                Historical permission decisions (auto-approve, user decisions, AI review).
              </div>
            </div>
            <button
              onClick={() => { setPermLogs([]); void loadPermissionLogs(0, permLogsFilter); }}
              disabled={permLogsLoading}
              className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground text-secondary-foreground rounded-lg transition-colors"
            >
              {permLogsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {/* Filter */}
          <div className="flex gap-1">
            {(['', 'allow', 'deny'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => { setPermLogs([]); setPermLogsFilter(filter); }}
                className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                  permLogsFilter === filter
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary/80 text-muted-foreground hover:text-foreground'
                }`}
              >
                {filter === '' ? 'All' : filter === 'allow' ? 'Allow' : 'Deny'}
              </button>
            ))}
          </div>

          {permLogsError && (
            <div className="text-xs text-destructive">{permLogsError}</div>
          )}
          {!permLogsError && permLogs.length === 0 && !permLogsLoading && (
            <div className="text-xs text-muted-foreground">No permission logs recorded.</div>
          )}
          {permLogs.length > 0 && (
            <div className="space-y-1.5 max-h-80 overflow-auto">
              {permLogs.map((entry) => (
                <div key={entry.id} className="p-2 bg-background/70 rounded-lg flex items-start gap-2">
                  <span className={`mt-0.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${
                    entry.decision === 'allow' ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-[11px] font-medium truncate">{entry.tool}</code>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {entry.remembered === 1 && (
                          <span className="text-[10px] text-muted-foreground">remembered</span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(entry.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {entry.detail && (
                      <div className="text-[11px] text-muted-foreground truncate">{entry.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {permLogs.length > 0 && permLogs.length < permLogsTotal && (
            <button
              onClick={() => { void loadPermissionLogs(permLogs.length, permLogsFilter); }}
              disabled={permLogsLoading}
              className="w-full py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {permLogsLoading ? 'Loading…' : `Load more (${permLogs.length}/${permLogsTotal})`}
            </button>
          )}
        </div>

        {/* AI Review Simulator */}
        <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
          <div>
            <div className="text-sm">AI Review Simulator</div>
            <div className="text-xs text-muted-foreground">
              Test how AI review evaluates different commands with your configured providers.
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={simToolName}
                onChange={(e) => setSimToolName(e.target.value)}
                className="px-2 py-1 text-xs bg-background border border-border rounded-lg w-24"
              >
                <option value="Bash">Bash</option>
                <option value="Write">Write</option>
                <option value="Edit">Edit</option>
                <option value="Read">Read</option>
              </select>
              <input
                type="text"
                value={simDetail}
                onChange={(e) => setSimDetail(e.target.value)}
                placeholder="Command or detail (e.g. rm -rf /tmp/test)"
                className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded-lg"
              />
            </div>

            <input
              type="text"
              value={simCwd}
              onChange={(e) => setSimCwd(e.target.value)}
              placeholder="Working directory (cwd)"
              className="w-full px-2 py-1 text-xs bg-background border border-border rounded-lg"
            />

            <div className="flex gap-2 items-center">
              <select
                value={simProviderId}
                onChange={(e) => setSimProviderId(e.target.value)}
                className="px-2 py-1 text-xs bg-background border border-border rounded-lg flex-1"
              >
                {simProviders.length === 0 && <option value="">No providers</option>}
                {simProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground">Threshold:</span>
                <input
                  type="number"
                  value={simThreshold}
                  onChange={(e) => setSimThreshold(parseFloat(e.target.value) || 0.8)}
                  min={0}
                  max={1}
                  step={0.1}
                  className="w-14 px-1 py-1 text-xs bg-background border border-border rounded-lg text-center"
                />
              </div>

              <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 gap-0.5">
                {(['quick', 'full', 'runtime', 'workflow'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setSimMode(m)}
                    className={`px-2 py-0.5 text-[11px] rounded-md transition-colors ${
                      simMode === m
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {{ quick: 'Quick', full: 'Full', runtime: 'Runtime', workflow: 'Workflow' }[m]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={() => { void handleRunSimulation(); }}
            disabled={simRunning || !simDetail.trim() || simProviders.length === 0}
            className="w-full py-1.5 text-xs bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-lg font-medium transition-colors"
          >
            {simRunning ? 'Running Review…' : 'Run Review'}
          </button>

          {simError && (
            <div className="text-xs text-destructive">{simError}</div>
          )}

          {simResult && (
            <div className="p-3 bg-background/70 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 text-[11px] font-medium rounded ${
                    simResult.decision === 'approve'
                      ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                      : simResult.decision === 'deny'
                        ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                        : 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
                  }`}>
                    {simResult.decision.toUpperCase()}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {Math.round(simResult.confidence * 100)}% confidence
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {simResult.durationMs}ms • {simResult.providerType} • {simResult.mode}
                </span>
              </div>

              {/* Confidence bar */}
              <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    simResult.confidence >= 0.8 ? 'bg-green-500'
                      : simResult.confidence >= 0.5 ? 'bg-yellow-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${simResult.confidence * 100}%` }}
                />
              </div>

              <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                {simResult.reasoning}
              </div>

              {simResult.metadata && Object.keys(simResult.metadata).length > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  {Object.entries(simResult.metadata).map(([k, v]) => (
                    <span key={k} className="mr-2">{k}: {String(v)}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
