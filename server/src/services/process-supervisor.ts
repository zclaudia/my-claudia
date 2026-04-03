import { execFile, spawn as nodeSpawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { isProcessAlive, listAllProcesses, listDescendantProcesses } from '../utils/process-tree.js';

const execFileAsync = promisify(execFile);

const PROCESS_SCAN_INTERVAL_MS = 10_000;
const GC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TERMINAL_RECORDS = 1000;
let globalProcessSupervisor: ProcessSupervisor | null = null;

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

export interface SpawnSpec {
  source: ManagedProcessSource;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  owner?: {
    sessionId?: string;
    taskId?: string;
    backendId?: string;
    runId?: string;
    requestId?: string;
  };
  tags?: string[];
  protected?: boolean;
  parentProcessId?: string | null;
  createProcessGroup?: boolean;
  stdio?: SpawnOptionsWithoutStdio['stdio'];
}

export interface SpawnHandle {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  readonly stdin: NodeJS.WritableStream | null;
  readonly exitPromise: Promise<{ code: number | null; signal: string | null }>;
  kill(signal?: NodeJS.Signals): void;
}

export interface SpawnResult {
  processId: string;
  pid: number | null;
  pgid: number | null;
  handle: SpawnHandle;
}

interface ManagedProcessRow {
  process_id: string;
  source: ManagedProcessSource;
  status: ManagedProcessStatus;
  pid: number | null;
  ppid: number | null;
  root_pid: number | null;
  pgid: number | null;
  command: string;
  args_json: string;
  cwd: string | null;
  owner_session_id: string | null;
  owner_task_id: string | null;
  owner_backend_id: string | null;
  owner_run_id: string | null;
  owner_request_id: string | null;
  parent_process_id: string | null;
  started_at: number;
  exited_at: number | null;
  exit_code: number | null;
  signal: string | null;
  protected: number;
  tags_json: string;
  adopted: number;
  orphaned_at: number | null;
  metadata_json: string | null;
}

interface RuntimeState {
  childPids: number[];
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function getProcessGroupId(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'pgid=', '-p', String(pid)]);
    const pgid = Number(stdout.trim());
    return Number.isFinite(pgid) ? pgid : null;
  } catch {
    return null;
  }
}

function classifyCommand(command: string, args: string[]): { source: ManagedProcessSource; tags: string[] } {
  const full = `${command} ${args.join(' ')}`.toLowerCase();
  const isTest =
    full.includes('vitest') ||
    full.includes('jest') ||
    full.includes('playwright') ||
    full.includes('cypress') ||
    /\bnpm\s+test\b/.test(full) ||
    /\bpnpm\s+test\b/.test(full);

  return {
    source: isTest ? 'test_run' : 'workspace_command',
    tags: isTest ? ['test'] : [],
  };
}

export class ProcessSupervisor {
  private readonly runtime = new Map<string, RuntimeState>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: Database.Database) {}

  start(): void {
    this.runGarbageCollection();
    void this.adoptPersistedProcesses();
    this.scanTimer = setInterval(() => {
      void this.refreshRuntimeChildren();
    }, PROCESS_SCAN_INTERVAL_MS);
    this.gcTimer = setInterval(() => {
      this.runGarbageCollection();
    }, GC_INTERVAL_MS);
  }

  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.scanTimer = null;
    this.gcTimer = null;
  }

  async spawn(spec: SpawnSpec): Promise<SpawnResult> {
    const processId = this.prepareRecord(spec);
    const env: NodeJS.ProcessEnv = this.buildChildEnv(spec, processId);

    const child = nodeSpawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env,
      detached: spec.createProcessGroup === true,
      stdio: spec.stdio ?? ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    const exitPromise = this.attachChildProcess(processId, child);

    return {
      processId,
      pid: child.pid ?? null,
      pgid: null,
      handle: {
        stdout: child.stdout,
        stderr: child.stderr,
        stdin: child.stdin,
        exitPromise,
        kill: (signal?: NodeJS.Signals) => {
          try {
            child.kill(signal);
          } catch {
            // Ignore already-exited processes.
          }
        },
      },
    };
  }

  observeChildProcess(spec: Omit<SpawnSpec, 'stdio' | 'env'>, child: ChildProcess): string {
    const processId = this.prepareRecord(spec);
    void this.attachChildProcess(processId, child);
    return processId;
  }

  async trackCommand(spec: Omit<SpawnSpec, 'source' | 'tags'> & { command: string; args?: string[] }): Promise<SpawnResult> {
    const args = spec.args ?? [];
    const classified = classifyCommand(spec.command, args);
    return this.spawn({
      ...spec,
      args,
      source: classified.source,
      tags: classified.tags,
    });
  }

  async adoptPersistedProcesses(): Promise<void> {
    const rows = this.db.prepare(`
      SELECT *
      FROM managed_processes
      WHERE status IN ('starting', 'running', 'orphaned')
      ORDER BY started_at DESC
    `).all() as ManagedProcessRow[];

    if (rows.length === 0) return;
    const allProcesses = await listAllProcesses();
    const byPid = new Map(allProcesses.map((proc) => [proc.pid, proc]));

    for (const row of rows) {
      const pid = row.root_pid ?? row.pid;
      if (!pid || !isProcessAlive(pid)) {
        this.updateRecord(row.process_id, {
          status: row.status === 'starting' ? 'failed' : 'exited',
          exitedAt: Date.now(),
        });
        continue;
      }

      const procInfo = byPid.get(pid);
      const expectedArgs = `${row.command} ${parseJsonArray(row.args_json).join(' ')}`.trim();
      const commandMatches = !procInfo || procInfo.args.includes(expectedArgs) || procInfo.command.includes(row.command);
      const elapsedOk = !procInfo || (Date.now() - row.started_at) >= (procInfo.elapsedSeconds * 1000 - 60_000);

      if (commandMatches && elapsedOk) {
        this.runtime.set(row.process_id, { childPids: [] });
        this.updateRecord(row.process_id, {
          status: 'orphaned',
          adopted: true,
          orphanedAt: row.orphaned_at ?? Date.now(),
          pid,
          rootPid: pid,
          pgid: row.pgid ?? await getProcessGroupId(pid),
        });
      }
    }
  }

  listProcesses(): ManagedProcessRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM managed_processes
      ORDER BY started_at DESC
      LIMIT 200
    `).all() as ManagedProcessRow[];
    return rows.map((row) => this.toRecord(row));
  }

  getProcess(processId: string): ManagedProcessRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM managed_processes
      WHERE process_id = ?
      LIMIT 1
    `).get(processId) as ManagedProcessRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  private toRecord(row: ManagedProcessRow): ManagedProcessRecord {
    const runtime = this.runtime.get(row.process_id);
    const childPids = runtime?.childPids ?? [];
    return {
      processId: row.process_id,
      source: row.source,
      status: row.status,
      pid: row.pid,
      ppid: row.ppid,
      rootPid: row.root_pid,
      pgid: row.pgid,
      command: row.command,
      args: parseJsonArray(row.args_json),
      cwd: row.cwd,
      ownerSessionId: row.owner_session_id,
      ownerTaskId: row.owner_task_id,
      ownerBackendId: row.owner_backend_id,
      ownerRunId: row.owner_run_id,
      ownerRequestId: row.owner_request_id,
      parentProcessId: row.parent_process_id,
      childPids,
      childCount: childPids.length,
      startedAt: row.started_at,
      exitedAt: row.exited_at,
      exitCode: row.exit_code,
      signal: row.signal,
      protected: Boolean(row.protected),
      tags: parseJsonArray(row.tags_json),
      adopted: Boolean(row.adopted),
      orphanedAt: row.orphaned_at,
      metadata: parseJsonObject(row.metadata_json),
    };
  }

  private buildChildEnv(spec: SpawnSpec, processId: string): NodeJS.ProcessEnv {
    const inherited = spec.env ?? {};
    return {
      ...process.env,
      ...inherited,
      _MC_PROCESS_ID: processId,
      _MC_SOURCE: spec.source,
      ...(spec.owner?.sessionId ? { _MC_OWNER_SESSION: spec.owner.sessionId } : {}),
      ...(spec.owner?.taskId ? { _MC_OWNER_TASK: spec.owner.taskId } : {}),
      ...(spec.parentProcessId ? { _MC_PARENT_PROCESS_ID: spec.parentProcessId } : {}),
    };
  }

  private prepareRecord(spec: Omit<SpawnSpec, 'stdio' | 'env'> | SpawnSpec): string {
    const processId = randomUUID();
    this.insertRecord({
      processId,
      source: spec.source,
      status: 'starting',
      pid: null,
      ppid: null,
      rootPid: null,
      pgid: null,
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd ?? null,
      ownerSessionId: spec.owner?.sessionId ?? null,
      ownerTaskId: spec.owner?.taskId ?? null,
      ownerBackendId: spec.owner?.backendId ?? null,
      ownerRunId: spec.owner?.runId ?? null,
      ownerRequestId: spec.owner?.requestId ?? null,
      parentProcessId: spec.parentProcessId ?? null,
      startedAt: Date.now(),
      exitedAt: null,
      exitCode: null,
      signal: null,
      protected: spec.protected ?? false,
      tags: spec.tags ?? [],
      adopted: false,
      orphanedAt: null,
      metadata: null,
    });
    return processId;
  }

  private attachChildProcess(processId: string, child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
    return new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      let initialized = false;
      const initialize = async () => {
        if (initialized) return;
        initialized = true;
        const pid = child.pid ?? null;
        const pgid = pid ? await getProcessGroupId(pid) : null;
        this.runtime.set(processId, { childPids: [] });
        this.updateRecord(processId, {
          status: 'running',
          pid,
          ppid: process.pid,
          rootPid: pid,
          pgid,
        });
      };

      child.once('spawn', () => {
        void initialize();
      });
      if (child.pid) {
        queueMicrotask(() => {
          void initialize();
        });
      }

      child.once('error', (error) => {
        this.updateRecord(processId, {
          status: 'failed',
          exitedAt: Date.now(),
          metadata: { spawnError: error.message },
        });
      });

      child.once('exit', (code, signal) => {
        this.runtime.delete(processId);
        this.updateRecord(processId, {
          status: code === 0 ? 'exited' : 'failed',
          exitedAt: Date.now(),
          exitCode: code,
          signal,
        });
        resolve({ code, signal });
      });
    });
  }

  private async refreshRuntimeChildren(): Promise<void> {
    for (const [processId] of this.runtime) {
      const row = this.db.prepare(`
        SELECT root_pid, status
        FROM managed_processes
        WHERE process_id = ?
      `).get(processId) as { root_pid: number | null; status: ManagedProcessStatus } | undefined;

      if (!row?.root_pid) continue;
      if (!isProcessAlive(row.root_pid)) {
        this.runtime.delete(processId);
        if (row.status === 'running') {
          this.updateRecord(processId, {
            status: 'exited',
            exitedAt: Date.now(),
          });
        }
        continue;
      }

      const descendants = await listDescendantProcesses(row.root_pid);
      const runtime = this.runtime.get(processId);
      if (runtime) {
        runtime.childPids = descendants.map((proc) => proc.pid);
      }
    }
  }

  private insertRecord(record: Omit<ManagedProcessRecord, 'childPids' | 'childCount'>): void {
    this.db.prepare(`
      INSERT INTO managed_processes (
        process_id, source, status, pid, ppid, root_pid, pgid, command, args_json, cwd,
        owner_session_id, owner_task_id, owner_backend_id, owner_run_id, owner_request_id,
        parent_process_id, started_at, exited_at, exit_code, signal, protected, tags_json,
        adopted, orphaned_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.processId,
      record.source,
      record.status,
      record.pid,
      record.ppid,
      record.rootPid,
      record.pgid,
      record.command,
      JSON.stringify(record.args),
      record.cwd,
      record.ownerSessionId,
      record.ownerTaskId,
      record.ownerBackendId,
      record.ownerRunId,
      record.ownerRequestId,
      record.parentProcessId,
      record.startedAt,
      record.exitedAt,
      record.exitCode,
      record.signal,
      record.protected ? 1 : 0,
      JSON.stringify(record.tags),
      record.adopted ? 1 : 0,
      record.orphanedAt,
      record.metadata ? JSON.stringify(record.metadata) : null,
    );
  }

  private updateRecord(processId: string, patch: {
    status?: ManagedProcessStatus;
    pid?: number | null;
    ppid?: number | null;
    rootPid?: number | null;
    pgid?: number | null;
    exitedAt?: number | null;
    exitCode?: number | null;
    signal?: string | null;
    adopted?: boolean;
    orphanedAt?: number | null;
    metadata?: Record<string, unknown>;
  }): void {
    const current = this.getProcess(processId);
    if (!current) return;
    const nextMetadata = patch.metadata ? patch.metadata : current.metadata;
    this.db.prepare(`
      UPDATE managed_processes
      SET status = ?,
          pid = ?,
          ppid = ?,
          root_pid = ?,
          pgid = ?,
          exited_at = ?,
          exit_code = ?,
          signal = ?,
          adopted = ?,
          orphaned_at = ?,
          metadata_json = ?
      WHERE process_id = ?
    `).run(
      patch.status ?? current.status,
      patch.pid ?? current.pid,
      patch.ppid ?? current.ppid,
      patch.rootPid ?? current.rootPid,
      patch.pgid ?? current.pgid,
      patch.exitedAt ?? current.exitedAt,
      patch.exitCode ?? current.exitCode,
      patch.signal ?? current.signal,
      patch.adopted === undefined ? (current.adopted ? 1 : 0) : (patch.adopted ? 1 : 0),
      patch.orphanedAt ?? current.orphanedAt,
      nextMetadata ? JSON.stringify(nextMetadata) : null,
      processId,
    );
  }

  private runGarbageCollection(): void {
    const cutoff = Date.now() - TERMINAL_RETENTION_MS;
    this.db.prepare(`
      DELETE FROM managed_processes
      WHERE status IN ('exited', 'failed', 'killed') AND exited_at IS NOT NULL AND exited_at < ?
    `).run(cutoff);

    const countRow = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM managed_processes
      WHERE status IN ('exited', 'failed', 'killed')
    `).get() as { count: number };

    const overflow = countRow.count - MAX_TERMINAL_RECORDS;
    if (overflow > 0) {
      this.db.prepare(`
        DELETE FROM managed_processes
        WHERE process_id IN (
          SELECT process_id
          FROM managed_processes
          WHERE status IN ('exited', 'failed', 'killed')
          ORDER BY exited_at ASC
          LIMIT ?
        )
      `).run(overflow);
    }
  }
}

export function setGlobalProcessSupervisor(supervisor: ProcessSupervisor | null): void {
  globalProcessSupervisor = supervisor;
}

export function getGlobalProcessSupervisor(): ProcessSupervisor | null {
  return globalProcessSupervisor;
}
