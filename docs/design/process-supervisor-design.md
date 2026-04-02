# Process Supervisor Design

## Background

The current product has partial process-management capabilities:

- provider child leak cleanup under the embedded server (`process-monitor.ts`)
- task-level stop operations for known background tasks (`backgroundTaskStore.ts`)
- passive PID liveness checks for tracked background tasks (10s polling interval)
- four-strategy fallback kill in `claude-adapter.ts:279-340` (SDK stop → PID kill → CLI tree kill → ps scan)

What is missing is a unified model for all locally launched commands. Process spawn calls are scattered across 17+ callsites in the codebase (provider SDKs, CLI jobs, MCP client, plugin loader, terminal manager, etc.) with no centralized registration. As a result:

- test processes launched from agent or tool flows are not consistently registered
- leaked workers can outlive their parent command and become orphaned under PID 1
- the UI has no stable entry point to inspect or terminate them (debug routes only expose `/api/debug/crashes`)
- app restart cannot recover ownership of previously launched local command processes
- `ProcessMonitor` state (ring buffer of 20 leak reports) is not exposed to the frontend

This document defines a standalone `ProcessSupervisor` architecture for managing all product-owned local command processes.

## Platform Scope

This is a **desktop-only** (macOS/Linux) feature. The embedded server that spawns local processes only runs on desktop — Android clients connect to remote servers via gateway and have no local process management needs. The supervisor API endpoints are available to all clients, but only meaningful when the server manages local processes.

## Feasibility Summary

This design is feasible, but only if process ownership is treated as a spawn-time concern rather than something reconstructed later from OS parent-child relationships.

The most important constraint is:

- process-tree scanning is not accurate enough to be the primary source of truth for ownership

Therefore the design is only viable if it uses a layered model:

1. authoritative spawn-time registration
2. optional inherited process markers
3. process-tree scanning as a best-effort supplement

With that adjustment, the architecture remains feasible in the current system because:

1. the backend already has process utilities that can be reused as supporting signals
2. the product already has server-to-client debug and monitoring patterns
3. existing task and provider cleanup logic can be migrated incrementally instead of rewritten all at once
4. the initial value can be delivered with a narrow scope covering `workspace_command` and `test_run` only

The hard part is not raw process inspection. The hard part is making ownership explicit and durable.

## Goals

1. Make all locally launched product-owned processes visible and manageable.
2. Track process trees instead of single PIDs.
3. Support explicit terminate and kill-tree operations, preferring process groups.
4. Persist process ownership so orphaned processes can be adopted after restart.
5. Provide a unified UI entry point for process inspection and cleanup.

## Scope

This supervisor should cover:

- workspace commands
- test runs
- provider CLI processes
- background task child processes
- embedded server sidecars where appropriate
- MCP servers if they are product-owned and launch-managed

It should not attempt to manage arbitrary third-party applications not launched by MyClaudia.

## Core Component

Introduce a new backend service: `ProcessSupervisor`.

Responsibilities:

1. single spawn entrypoint for product-owned local commands
2. process metadata registry
3. authoritative ownership tracking
4. process-group-first termination with tree-scan fallback
5. orphan adoption on startup
6. process state streaming to the desktop UI
7. record garbage collection for terminal processes

## Managed Process Model

```ts
type ManagedProcessSource =
  | 'provider_run'
  | 'background_task'
  | 'workspace_command'
  | 'test_run'
  | 'embedded_server'
  | 'mcp_server'
  | 'agent_tool'
  | 'unknown';

type ManagedProcessStatus =
  | 'starting'
  | 'running'
  | 'exited'
  | 'failed'
  | 'killing'
  | 'killed'
  | 'orphaned';

interface ManagedProcessRecord {
  processId: string;
  source: ManagedProcessSource;
  status: ManagedProcessStatus;

  pid: number | null;
  ppid: number | null;
  rootPid: number | null;
  pgid: number | null;                // process group ID, set when createProcessGroup is true

  command: string;
  args: string[];
  cwd: string | null;

  ownerSessionId?: string | null;
  ownerTaskId?: string | null;
  ownerBackendId?: string | null;
  ownerRunId?: string | null;
  ownerRequestId?: string | null;

  parentProcessId?: string | null;     // supervisor-level parent (product ownership)
  childPids: number[];                 // runtime-observed OS descendant PIDs (best-effort, not persisted)

  startedAt: number;
  exitedAt?: number | null;
  exitCode?: number | null;
  signal?: string | null;

  protected: boolean;                  // if true, supervisor refuses terminate (e.g. embedded server)
  tags: string[];

  adopted: boolean;
  orphanedAt?: number | null;

  metadata?: Record<string, unknown>;
}
```

## Design Notes

Key modeling decisions:

1. `processId` is the internal stable identity; PID is runtime metadata only.
2. `rootPid` is used for termination and diagnostics, not as the only ownership signal.
3. `pgid` enables process-group termination which is more reliable than tree-scan kill.
4. `parentProcessId` captures product-level ownership even when OS parentage changes.
5. `childPids` is runtime-only (not persisted) — observed by periodic tree scan, kept in memory only.
6. `adopted` and `orphanedAt` allow restart-time recovery of leaked processes.
7. `source` makes it possible to build first-class UI filters such as `test_run`.
8. `protected` replaces the original `canTerminate` to express "critical process that should not be killed" (e.g. embedded server) more clearly.
9. descendant trees are best-effort runtime observations, not the source of truth.

## Ownership Model

The supervisor must not rely on `ps` parent-child reconstruction as its primary ownership model.

Ownership is layered:

### Layer 1: authoritative ownership

Established at spawn time and persisted immediately.

Examples:

- `processId`
- `source`
- `ownerSessionId`
- `ownerTaskId`
- `ownerRunId`
- `parentProcessId`

This is the canonical record of who launched the process.

### Layer 2: strong recovery hints

Optional but highly recommended inherited markers.

Examples:

- `_MC_PROCESS_ID`
- `_MC_PARENT_PROCESS_ID`
- `_MC_SOURCE`
- `_MC_OWNER_SESSION`
- `_MC_OWNER_TASK`

Environment variable names use the `_MC_` prefix (underscore-prefixed to reduce collision risk with user code, short to minimize env pollution). These markers are only injected for `workspace_command` and `test_run` sources in V1 — provider CLI processes are excluded to avoid interfering with third-party tool behavior.

If child processes inherit these variables, orphan adoption becomes significantly more reliable.

### Layer 3: weak runtime hints

OS-level process inspection is still useful, but only as supporting evidence.

Examples:

- parent PID
- descendant scan
- command line matching
- cwd matching
- start time / elapsed time heuristics

These signals must never be treated as fully authoritative.

## Unified Spawn API

No component should call raw `spawn`, `Command.create`, or `Command.sidecar` directly for managed local commands. They should all go through the supervisor.

```ts
interface SpawnSpec {
  source: ManagedProcessSource;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
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
  createProcessGroup?: boolean;        // default: true; spawn with { detached: true } to create pgid
}

interface SpawnResult {
  processId: string;
  pid: number;
  pgid: number | null;
  handle: SpawnHandle;
}

interface SpawnHandle {
  readonly stdout: import('stream').Readable;
  readonly stderr: import('stream').Readable;
  readonly stdin: import('stream').Writable;
  readonly exitPromise: Promise<{ code: number | null; signal: string | null }>;
}
```

The supervisor wraps the raw `ChildProcess` in a `SpawnHandle` so callers retain full I/O access. The supervisor only adds registration, tracking, and termination coordination — it does not intercept or buffer streams.

Primary entrypoint:

```ts
processSupervisor.spawn(spec): Promise<SpawnResult>
```

## Spawn Lifecycle

The supervisor should implement the following lifecycle:

1. create a `ManagedProcessRecord` with status `starting`
2. persist the record before spawn completion
3. inject process ownership markers into the child environment (for `workspace_command` and `test_run` sources)
4. spawn the actual process with `{ detached: true }` if `createProcessGroup` is true (default)
5. write `pid`, `rootPid`, `pgid`, and transition to `running`
6. if spawn fails (e.g. ENOENT), immediately transition to `failed` and persist
7. start best-effort process-tree observation
8. on process exit, mark `exited`, `failed`, or `killed`
9. if descendants survive root exit, mark them orphaned until cleanup or adoption

## Process Group Termination

Process groups provide the most reliable termination strategy on Unix systems, significantly more dependable than tree-scan kill.

### Why process groups

When a process is spawned with `{ detached: true }`, Node.js calls `setsid()` which creates a new session and process group. All descendant processes (including those behind shell wrappers, npm scripts, etc.) inherit the same `pgid`. Killing the group with `kill(-pgid, signal)` reaches all members atomically, even if:

- descendants have re-parented to PID 1
- intermediate shell wrappers have exited
- the tree structure has changed since spawn

This addresses the core limitation of tree-scan kill documented in the "Important Limitation" section below.

### Termination flow

Default termination sequence:

1. if `pgid` is available: send `SIGTERM` to `-pgid` (entire process group)
2. wait grace period (3-5s)
3. if survivors remain: send `SIGKILL` to `-pgid`
4. if `pgid` is not available (legacy or adopted process): fall back to tree-scan kill via `killProcessTree(rootPid)` from `process-tree.ts`
5. write final status transitions per managed process

### Concurrency safety

Termination operations use a per-processId mutex to prevent concurrent `terminateProcess` / `terminateProcessTree` / `cleanupOrphanProcesses` calls from racing on the same PID. Implementation: a `Map<processId, Promise>` that serializes concurrent terminate requests.

Status transitions use compare-and-swap semantics: `terminateProcess` only proceeds if current status is `running` or `orphaned`. If status has already changed (e.g. process exited naturally during the terminate call), the operation is a no-op.

## Process Tree Tracking

The supervisor should track trees, but tree capture must be treated as best-effort.

Required behaviors:

1. periodically scan descendants of known `rootPid` (reuses existing `listDescendantProcesses()` from `process-tree.ts`)
2. maintain runtime child relationships in memory (not persisted — `childPids` field)
3. expose descendant counts and tree membership to the UI
4. terminate by process group (primary) or by tree scan (fallback)
5. fall back gracefully when descendants are not fully discoverable

### Important Limitation

A descendant process can:

- outlive its launcher
- re-parent to PID 1
- be missed between scan intervals
- be launched behind multiple shell wrappers

Therefore the supervisor can reliably own:

- the launched root process
- process metadata created at spawn time
- the process group (when `createProcessGroup` is true)

but only best-effort observe:

- the exact full descendant set at all times

Process group termination mitigates most of these limitations — even re-parented descendants remain in the same pgid.

## Record Garbage Collection

Terminal process records (`exited`, `failed`, `killed`) accumulate over time and must be cleaned up.

### GC strategy

- **Retention**: terminal records are kept for 7 days or until the table exceeds 1000 terminal records (whichever triggers first)
- **Trigger**: GC runs on server startup and then every 6 hours
- **Scope**: only terminal records are eligible; `running`, `starting`, `killing`, `orphaned` records are never GC'd
- **Implementation**: `DELETE FROM managed_processes WHERE status IN ('exited','failed','killed') AND exited_at < ? ORDER BY exited_at ASC LIMIT ?`

### Startup GC pass

On server startup, before orphan adoption:

1. delete terminal records older than 7 days
2. if terminal record count > 1000, delete oldest until at or below 1000
3. then run orphan adoption pass (operating on remaining non-terminal records)

## Why This Is Feasible

### 1. We already have usable process utilities, but they are supporting signals only

The backend already contains a reusable process-tree utility in `server/src/utils/process-tree.ts`.

Existing capabilities already present:

- `isProcessAlive(pid)` — `process.kill(pid, 0)` signal check
- `listDescendantProcesses(parentPid)` — BFS tree traversal via `ps -e -o pid=,ppid=,etimes=,comm=,args=`
- `listAllProcesses()` — full process list
- `findProcessesByArgsIncludes(needles)` — command-line search
- `killProcessTree(pid)` — two-phase SIGTERM → SIGKILL with leaf-to-root ordering

This means the supervisor does not need a brand-new OS abstraction layer in version 1. However, these primitives should be treated as supporting tools for observation and fallback cleanup, not the primary ownership or termination source. Process group kill (`kill(-pgid)`) is the preferred termination path.

### 2. The backend already exposes debug and cleanup flows to the UI

The product already has a pattern for surfacing backend diagnostics to the client:

- debug HTTP APIs such as `server/src/routes/debug.ts` (currently only `/api/debug/crashes`)
- settings/debug UI patterns
- WebSocket task and process cleanup notifications

This makes it practical to add:

- `GET /api/debug/processes`
- `POST /api/debug/processes/:id/terminate`
- `POST /api/debug/processes/:id/kill-tree`
- `POST /api/debug/processes/cleanup-orphans`

without introducing a new transport model just for process management.

### 3. Existing cleanup logic can be reused and progressively delegated

The current `ProcessMonitor` (`server/src/utils/process-monitor.ts`) and task-stop flows are not wasted work. They already encode:

- when it is safe to scan for leaks (only when `activeRunCount === 0`)
- when a process belongs to an active run
- how to stop trees and report results (four-strategy fallback in `claude-adapter.ts`)

That logic can be migrated in stages:

1. keep existing `ProcessMonitor` behavior
2. add `ProcessSupervisor` beside it
3. change termination calls to go through the supervisor
4. finally reduce `ProcessMonitor` to provider-specific heuristics and reporting

This significantly lowers migration risk.

### 4. SQLite persistence fits the current backend architecture

The backend already persists runtime-adjacent operational data in SQLite. Adding one more table for managed processes is operationally consistent with the current architecture:

- no new storage technology
- no cross-process coordinator required
- restart adoption can happen synchronously during server startup

This is important because the core value of the supervisor is restart-time recovery of process ownership.

### 5. The first version can be intentionally narrow

The design looks broad, but it does not need to land fully to be useful.

A practical version 1 can limit itself to:

- `workspace_command`
- `test_run`
- `terminate tree` (process group first, tree scan fallback)
- orphan adoption
- read-only process list UI

That already solves the concrete leak class seen with orphaned `vitest` workers, while leaving provider and MCP integration for later phases.

## Implementation Feasibility by Layer

### Backend feasibility

Backend work is straightforward and low-risk.

Why:

1. the server already owns the execution environment for many local-process actions
2. process inspection and termination code already exists
3. persistence via SQLite already exists

Most backend complexity is plumbing, not research, as long as the design does not over-promise perfect descendant capture.

Expected backend additions:

- `ProcessSupervisor` service
- `managed_processes` table and repository
- process startup wrappers with process-group creation
- debug/process routes
- adoption pass during server startup
- GC pass for terminal records

### Frontend feasibility

Frontend work is moderate but also straightforward.

Why:

1. the app already has debug/settings surfaces
2. there are already stores for background tasks and process cleanup results
3. list-and-action UI patterns already exist in Settings and panels

The main frontend work is modeling:

- process list query state
- selection/filter state
- terminate/cleanup actions
- polling or push-based updates

This does not require a new UI framework or navigation model.

### Migration feasibility

Migration is feasible because ownership can be layered instead of switched atomically.

Recommended order:

1. instrument new spawns with the supervisor
2. expose process list in debug UI
3. start using supervisor for new test and workspace command flows
4. later backfill provider and background-task integrations

This means the system can operate in a mixed mode for some time:

- legacy cleanup still works for existing provider flows
- supervisor manages newly integrated command sources

## Main Risks

### 1. Process-tree capture accuracy is limited

This is the top risk and design constraint.

OS parent-child reconstruction is inherently lossy for this use case because:

- shell wrappers obscure the real logical task boundary
- descendants can re-parent after launcher exit
- `ps` scans are snapshot-based, not event streams
- short-lived intermediates can disappear before observation

Impact:

- a full descendant set cannot be treated as authoritative
- some leaked workers may only be recoverable if they inherited markers or remain attributable by strong heuristics

Mitigation:

1. make spawn-time registration authoritative
2. inject inherited environment markers where possible
3. treat tree scans as best-effort support only
4. **prefer process-group termination over descendant enumeration** — this is the primary mitigation

### 2. Not all process launches currently pass through one place

This is the biggest real risk.

The architecture only pays off if product-owned local commands stop bypassing the supervisor. If some paths continue calling raw `spawn` or `Command.sidecar` directly, the registry will remain incomplete.

Mitigation:

1. create a strongly named wrapper module and ban raw spawn usage in reviewed paths
2. migrate high-risk command sources first
3. add linting or grep-based CI checks for direct spawn callsites where practical

### 3. Parent-child relationships can drift from OS reality

A command can exit while descendants survive, or shell wrappers can obscure true ownership. That is exactly why product-level `parentProcessId` and `rootPid` are both needed. Process-group termination also avoids this issue entirely since pgid membership persists even when the tree structure changes.

Mitigation:

1. treat `pgid` as the primary kill authority when available
2. treat `rootPid` as fallback kill authority (tree-scan kill)
3. treat `parentProcessId` as UI and ownership metadata only
4. periodically rescan descendants to correct runtime tree shape

### 4. Adoption after restart can misclassify processes

If adoption relies only on PID persistence, it can theoretically misidentify recycled PIDs after long delays.

Mitigation:

1. store `startedAt`
2. compare elapsed time and command line when adopting
3. inject supervisor environment variables for `workspace_command` and `test_run` sources
4. if `pgid` is persisted, verify group membership via `ps -o pgid= -p <pid>`

Version 1 can still ship with conservative adoption that does not pretend to recover all possible descendants.

### 5. Process list noise can overwhelm the UI

If every helper and descendant is surfaced at equal importance, the process UI will become unusable.

Mitigation:

1. surface roots by default
2. hide descendants behind expansion
3. filter aggressively by `source`, `status`, and `tags`
4. default the UI to product-meaningful categories such as `Tests`, `Tasks`, `Providers`

### 6. Cross-platform differences

Process inspection on macOS is already supported by current utilities, but Windows and Linux process-tree behavior may differ.

Mitigation:

1. build v1 on the same primitives already used by the product
2. keep supervisor interfaces platform-agnostic
3. isolate platform-specific behavior inside the process-tree utility layer

This risk is real, but it does not block initial implementation for the current desktop target.

### 7. Environment marker pollution

Injecting `_MC_*` environment variables into child processes could theoretically be inherited by user code or interfere with third-party tools.

Mitigation:

1. use underscore-prefixed naming (`_MC_*`) to reduce collision risk
2. only inject markers for `workspace_command` and `test_run` sources in V1
3. exclude provider CLI processes (`provider_run`) from environment injection to avoid interfering with claude/opencode/cursor/etc.
4. document the marker variables so they can be excluded from leak-sensitive environments if needed

## Cost vs. Value

### Cost

Estimated engineering cost is medium, not small.

Why:

- server service and persistence work
- spawn-callsite migration
- new debug routes
- UI list and actions
- adoption logic and testing

### Value

The operational value is high.

This design addresses:

- leaked test workers
- lack of a unified stop/kill entrypoint
- missing process visibility for support and debugging
- restart-time orphan recovery

It also creates a reusable base for later features:

- test-run management UI
- richer task/process correlation
- provider process introspection
- MCP process management

## Recommended V1 Boundary

To keep the first implementation realistic, version 1 should include only:

1. backend `ProcessSupervisor` with process-group spawn
2. persistence table with GC
3. integration for `workspace_command` and `test_run`
4. conservative orphan adoption on startup
5. `list / terminate tree / cleanup orphans` APIs
6. a basic `Settings > Debug > Processes` view
7. environment tagging for `workspace_command` and `test_run` sources

Version 1 should explicitly exclude:

- provider integration rewrite
- MCP full management
- guarantees of exact full descendant capture
- historical analytics

That boundary is small enough to ship and large enough to solve the current leak class.

## Success Criteria

The design should be considered successful if all of the following become true:

1. newly launched test commands always appear in the registry at root-process level
2. a leaked `vitest` worker that remains attributable after restart appears in the process UI as `orphaned`
3. the user can terminate the managed root and observed descendants from the UI without shell access
4. background task and provider cleanup can progressively migrate onto the same primitives

## Orphan Adoption

This is required to solve the current `vitest` leak class and must be included in the initial rollout.

On startup (after GC pass):

1. load persisted `ManagedProcessRecord`s in `starting`, `running`, `killing`, or `orphaned`
2. check whether `rootPid` is still alive via `isProcessAlive()`
3. if alive, verify using available evidence (in order of strength):
   - `_MC_PROCESS_ID` environment marker match (if present in `/proc/<pid>/environ` or via `ps eww`)
   - command line match
   - cwd match
   - elapsed time vs `startedAt` plausibility check
   - `pgid` membership verification via `ps -o pgid= -p <pid>`
4. if evidence is sufficient, mark the record as `orphaned` and `adopted = true`
5. if evidence is weak, leave it unadopted or surface it as a lower-confidence candidate in the UI
6. if not alive, mark it as `exited`
7. resume best-effort process-tree observation for adopted roots

This allows the app to regain control of leaked command trees after restart.

## Environment Tagging

To improve adoption reliability and diagnostics, the supervisor injects environment variables into launched commands where appropriate:

- `_MC_PROCESS_ID` — supervisor-assigned stable process identifier
- `_MC_SOURCE` — process source classification (e.g. `test_run`)
- `_MC_OWNER_SESSION` — owning session ID
- `_MC_OWNER_TASK` — owning task ID

Injection scope:

- **Always inject**: `workspace_command`, `test_run`, `agent_tool` — these are short-lived, product-controlled commands
- **Never inject in V1**: `provider_run`, `mcp_server`, `embedded_server` — these are long-lived third-party tools where env pollution carries higher risk
- **Future**: provider injection can be enabled per-provider based on compatibility testing

## Persistence

Use SQLite for persistence so process ownership survives app restarts.

Suggested schema:

```sql
CREATE TABLE managed_processes (
  process_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  pid INTEGER,
  ppid INTEGER,
  root_pid INTEGER,
  pgid INTEGER,
  command TEXT NOT NULL,
  args_json TEXT NOT NULL,
  cwd TEXT,
  owner_session_id TEXT,
  owner_task_id TEXT,
  owner_backend_id TEXT,
  owner_run_id TEXT,
  owner_request_id TEXT,
  parent_process_id TEXT,
  started_at INTEGER NOT NULL,
  exited_at INTEGER,
  exit_code INTEGER,
  signal TEXT,
  protected INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL,
  adopted INTEGER NOT NULL DEFAULT 0,
  orphaned_at INTEGER,
  metadata_json TEXT
);

CREATE INDEX idx_managed_processes_status ON managed_processes(status);
CREATE INDEX idx_managed_processes_source ON managed_processes(source);
CREATE INDEX idx_managed_processes_exited_at ON managed_processes(exited_at);
```

Note: `child_process_ids_json` is removed from the schema. Runtime-observed descendant PIDs (`childPids`) are kept in memory only — persisting them would require frequent writes on every tree scan with no recovery value (PIDs are not stable across restarts).

## Public Operations

Suggested supervisor API:

```ts
spawn(spec: SpawnSpec): Promise<SpawnResult>
getProcess(processId: string): Promise<ManagedProcessRecord | null>
listProcesses(filter?: ProcessFilter): Promise<ManagedProcessRecord[]>
terminateProcess(processId: string): Promise<void>
terminateProcessTree(processId: string): Promise<void>
cleanupOrphanProcesses(filter?: ProcessFilter): Promise<CleanupSummary>
adoptPersistedProcesses(): Promise<void>
```

Termination rules:

- `terminateProcessTree` should be the default UI-facing action
- internally uses process-group kill (`kill(-pgid)`) when available, tree-scan kill as fallback
- single-process terminate should remain available but secondary
- cleanup actions should support filters such as `source=test_run` or `status=orphaned`
- all terminate operations acquire per-processId mutex and check current status before proceeding

## Integration with Existing Systems

### ProcessMonitor

Current role:

- detect leaked provider child processes under the server process tree
- 30s scan interval, only when `activeRunCount === 0`
- cooldown/notification backoff (5min → 15min → 30min cap)

Future role:

- keep provider-specific leak heuristics
- delegate actual termination to `ProcessSupervisor`
- emit managed-process-aware diagnostics instead of direct raw PID kills when possible

### BackgroundTaskStore

Current role:

- stores task metadata and optionally tracks `cliPid` or `taskRootPid`
- 10s PID liveness polling via `getProcessInfo()` API

Future role:

- store `processId` as the primary process handle
- use the supervisor for termination and state updates
- keep `cliPid` only as derived display metadata

### Provider stop-task handling

Current stop logic (`claude-adapter.ts:279-340`, `handlers/run.ts:28-148`) falls back through:

1. SDK `stopTask()` — application-layer graceful stop
2. direct PID kill via `killProcessTree()`
3. CLI process tree kill
4. system-wide `ps` scan + command match kill

Future logic should layer application-layer stop above supervisor OS-layer kill:

1. provider adapter attempts SDK `stopTask()` (application-layer graceful stop, unchanged)
2. if timeout or failure: delegate to `supervisor.terminateProcessTree(processId)` (OS-layer kill)
3. provider adapter fallback only when no managed process exists (legacy path)

The supervisor handles OS-level termination only. Application-layer graceful stop (e.g. SDK `stopTask()`) remains the provider adapter's responsibility. These are two layers, not a replacement.

## UI Entry Point

Add a dedicated UI surface for managed processes instead of relying on the current provider-only cleanup action.

Recommended placement:

- `Settings > Debug > Processes`

Minimum feature set:

1. list all managed processes
2. filter by source: `test_run`, `workspace_command`, `provider_run`, `mcp_server`
3. filter by status: `running`, `orphaned`, `failed`, `killing`
4. display command, cwd, runtime, PID, owner, and child-count
5. actions:
   - `Terminate`
   - `Kill Tree`
   - `Clean Orphans`
   - `Reveal Owner`

## Source Classification

To solve the current test leakage issue cleanly, supervisor records should classify testing commands explicitly.

Recommended rules:

1. UI-initiated test execution uses `source: test_run`
2. agent or tool launched commands default to `workspace_command`
3. commands matching common test patterns receive an extra `test` tag:
   - `vitest`
   - `jest`
   - `playwright`
   - `cypress`
   - `npm test`
   - `pnpm test`

This supports:

- targeted cleanup of orphaned test processes
- better diagnostics
- future product-specific UI such as a test-run history panel

## Rollout Plan

### Phase 1

- add `ManagedProcessRecord` and persistence table (with GC)
- introduce `ProcessSupervisor` with process-group spawn
- integrate only `workspace_command` and `test_run`
- orphan adoption on server startup
- environment tagging for `workspace_command` and `test_run`

### Phase 2

- add `Processes` debug UI
- allow terminate and orphan cleanup from the client
- add tagging and cross-linking to owners in UI

### Phase 3

- integrate `backgroundTaskStore` with `processId`
- switch task termination to supervisor-first

### Phase 4

- integrate provider-launched processes
- make `ProcessMonitor` supervisor-aware
- layer provider SDK stop above supervisor OS kill

## Why This Solves the Current Leak Class

The current leaked `vitest` workers are not solvable by provider-only cleanup because they are:

- not provider children in the embedded server process tree
- not registered as background tasks
- not represented in any unified process registry

With `ProcessSupervisor`:

1. test commands are registered at spawn time
2. the process group is captured at spawn, enabling reliable group-kill even if the tree structure changes
3. termination defaults to process-group kill, with tree-scan fallback
4. orphaned workers are persisted and adopted after restart
5. the UI gains a first-class process-management surface
