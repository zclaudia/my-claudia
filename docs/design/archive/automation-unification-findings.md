# Automation Unification — Findings and Design Direction

## Summary

The current automation surface has three user-facing systems plus one internal runtime registry:

1. Workflow
2. Scheduled Task
3. Agent Trigger
4. System Task (internal only)

The duplication is real, but the current problem is not only "too many entry points". The deeper issue is that these systems encode overlapping automation concepts with different lifecycle models, execution semantics, persistence strategies, and observability.

This document upgrades the earlier research notes into a design direction:

- Keep **System Task** separate as internal infrastructure.
- Converge **Workflow**, **Scheduled Task**, and **Agent Trigger** into one user-facing automation model.
- Use the existing **workflow graph engine** as the execution core.
- Preserve simple authoring by offering **presets / simplified editors** on top of the same model rather than keeping separate runtimes.

## Current Architecture

### 1. Workflow

- **DB tables**: `workflows`, `workflow_runs`, `workflow_step_runs`, `workflow_schedules`
- **Types**: `shared/src/features/workflows.ts`
- **Service**: `server/src/domains/workflows/service.ts`, `engine.ts`
- **Definition**: graph-based DAG, `{ nodes, edges, entryNodeId, triggers }`
- **Node types**: `git_commit`, `git_merge`, `create_worktree`, `create_pr`, `ai_review`, `ai_prompt`, `shell`, `webhook`, `condition`, `notify`, `wait`
- **Triggers**: `manual`, `cron`, `interval`, `event` (embedded in definition)
- **Execution**: graph traversal from `entryNodeId` with edge-based routing, error handling, and loop awareness
- **Templates**: 5 built-in

### 2. Scheduled Task

- **DB tables**: `scheduled_tasks`, `task_runs`
- **Types**: `shared/src/features/scheduled-tasks.ts`
- **Service**: `server/src/domains/scheduled-tasks/service.ts`
- **Schedule types**: `cron`, `interval`, `once`
- **Action types**: `prompt`, `command`, `shell`, `webhook`, `plugin_event`, `agent_task`
- **Execution**: tick loop finds due tasks and dispatches by `actionType`
- **Templates**: 4 built-in
- **Run history**: `task_runs`

### 3. Agent Trigger

- **DB table**: `agent_triggers`
- **Types**: `shared/src/features/agent-triggers.ts`
- **Service**: `server/src/domains/agent-triggers/service.ts`
- **Trigger types**: `event`, `schedule`, `both`
- **Event subscription**: `pluginEvents` glob matching
- **Template rendering**: `{{event.key}}`
- **Action**: always AI prompt
- **Plugin integration**: plugin-owned triggers via `sourcePluginId`

### 4. System Task

- **Registry**: `server/src/services/system-task-registry.ts`
- **Types**: `shared/src/features/system-tasks.ts`
- **Categories**: scheduling, sync, maintenance, supervision, plugin
- **Persistence**: none, in-memory only
- **Purpose**: internal runtime / operational concerns, not end-user automation authoring

## Overlap Analysis

| Capability | Workflow | Scheduled Task | Agent Trigger |
|------------|----------|----------------|---------------|
| Cron / interval trigger | Yes | Yes | Yes |
| Event trigger | Yes | No | Yes |
| AI prompt | Yes | Yes | Yes |
| Shell / command | Yes | Yes | No |
| Webhook | Yes | Yes | No |
| Multi-step | Yes | No | No |
| Conditional routing | Yes | No | No |
| Template rendering | No | No | Yes |
| Run history | Yes | Yes | No |
| Project/global scope | Yes | Yes | Yes |

## Confirmed Pain Points

1. Scheduled Task templates and Workflow templates overlap heavily.
2. Agent Trigger and Scheduled Task both duplicate trigger logic that already exists in Workflow.
3. The `agent_task` path in Scheduled Task is inconsistent across service, routes, and DB schema.
4. Users have no clear rule for when to choose Workflow vs Scheduled Task vs Agent Trigger.
5. Simple automations are easy to start in Scheduled Task, but chaining / branching requires switching mental models to Workflow.
6. Agent Trigger has useful template rendering and plugin ownership semantics that do not exist in Workflow.
7. Run history and operational observability are inconsistent across systems.

## Findings: What Was Missing From The Original Research

### 1. This is not just feature overlap, it is lifecycle overlap

The three systems do not only differ by action types. They differ in:

- how triggers are stored
- when schedules are materialized
- how enabled/disabled state works
- how execution records are persisted
- how plugin-owned registrations are cleaned up

Any unification plan that only compares action/trigger checkboxes will miss the hard part.

### 2. Workflow is the strongest execution core, but not the right authoring UX for every case

Workflow already supports:

- multiple trigger types
- branching and error routing
- reusable run history
- explicit execution graph

However, forcing every "run one shell every morning" use case into a graph editor would make simple cases worse.

The correct move is not "replace all UI with graph editing". The correct move is "use one runtime core, expose multiple authoring surfaces".

### 3. System Task should not be unified with user automations

System Task is operational infrastructure, not user-authored business logic.

It differs in two critical ways:

- it is in-memory / startup-registered
- it represents internal runtime machinery rather than end-user intent

Trying to merge it into the same persistence and UX model would create noise and security confusion.

### 4. The `agent_task` problem is a split-brain contract, not a single bug

Today:

- Scheduled Task service contains an `agent_task` execution branch.
- Scheduled Task route validation rejects `agent_task`.
- Scheduled Task DB schema also rejects `agent_task`.

This means product contract, API contract, and storage contract are already diverging. The fix should be to remove the ambiguity entirely, not to patch one layer.

## Design Goals

1. One user-facing automation model for all persisted automations.
2. One execution history model for all user automations.
3. One trigger model covering manual, cron, interval, once, and event.
4. Preserve simple authoring for single-step automations.
5. Preserve advanced authoring for branching / multi-step automations.
6. Support plugin-owned event automations without exposing internal system tasks.
7. Enable phased migration with backward compatibility.

## Non-Goals

1. Unifying internal System Task into the same product surface.
2. Replacing the workflow engine with a new runtime.
3. Solving every plugin automation abstraction in phase 1.
4. Shipping a single giant editor before data model convergence is complete.

## Proposed Target Model

### Core Decision

Use **Workflow** as the canonical persisted automation model.

Concretely:

- `workflows` becomes the canonical table for end-user automations.
- `workflow_runs` / `workflow_step_runs` become the canonical run history.
- Scheduled Task and Agent Trigger become authoring variants that compile into workflow definitions.

### Why Workflow As The Core

Because it already has:

- trigger support
- project/global scoping
- reusable run history
- graph execution semantics
- a richer superset of task composition

Scheduled Task and Agent Trigger are both subsets of this model if we add the missing pieces below.

## Required Model Extensions

### 1. Add `once` trigger to Workflow

Workflow triggers should support:

- `manual`
- `cron`
- `interval`
- `once`
- `event`

This closes the only major schedule gap vs Scheduled Task.

### 2. Add first-class template/context rendering to Workflow

Workflow needs a standard rendering layer for node config values, not just raw strings inside Agent Trigger.

Proposed direction:

- support template interpolation in selected node config fields
- support event payload binding
- support run metadata / previous step output binding
- keep the rendering contract explicit and typed

Suggested scope for phase 1:

- string interpolation in `ai_prompt`, `shell`, `webhook`, `notify`
- context sources:
  - `event.*`
  - `trigger.*`
  - `steps.<nodeId>.*`
  - `workflow.*`

### 3. Add workflow-level ownership metadata for plugin-managed automations

Agent Trigger has `sourcePluginId`. The unified model still needs this concept.

Add optional workflow metadata:

- `sourcePluginId?: string`
- `sourceType?: 'user' | 'plugin' | 'template'`
- `authoringMode?: 'simple' | 'graph' | 'agent-trigger' | 'scheduled-task'`

This preserves cleanup semantics and keeps the future UI honest about where an automation came from.

### 4. Add workflow-level presentation metadata for simple automations

Do not encode UX mode from graph shape inference alone.

Add optional metadata:

- `presentation.kind?: 'simple-task' | 'graph-workflow' | 'event-prompt'`

This allows the product to reopen an automation in the correct editor while still using one persisted model.

## Product Surface Proposal

### One Product Concept: Automation

Rename the user-facing concept to **Automation**.

Under the hood, persisted automations are workflows.

### Authoring Modes

Expose three creation flows backed by the same model:

1. **Simple Automation**
   - single action
   - schedule or event trigger
   - form-based editor
   - compiles to a single-node workflow

2. **AI Trigger Automation**
   - event/schedule + AI prompt oriented
   - form-based editor with template helpers
   - compiles to workflow with `ai_prompt` node

3. **Advanced Workflow**
   - full graph editor
   - direct authoring of DAG

These are entry points, not separate runtimes.

## Data Model Strategy

### Keep In Phase 1

- `workflows`
- `workflow_runs`
- `workflow_step_runs`
- `workflow_schedules`

### Freeze Then Migrate

- `scheduled_tasks`
- `task_runs`
- `agent_triggers`

### Do Not Unify

- internal system task registry

## Migration Plan

### Phase 0: Stop Further Divergence

1. No new templates should be added to Scheduled Task or Agent Trigger.
2. Fix the `agent_task` contract inconsistency by either removing it entirely or formally migrating it to Workflow-backed behavior.
3. Mark Scheduled Task and Agent Trigger as legacy authoring surfaces in code comments and product copy.

### Phase 1: Extend Workflow To Cover Missing Capability

1. Add `once` trigger.
2. Add template/context rendering.
3. Add workflow metadata for plugin ownership and authoring mode.
4. Add API support for simplified automation creation backed by workflows.

### Phase 2: Migrate Authoring Surfaces

1. Replace new Scheduled Task creation with "Simple Automation" backed by workflow.
2. Replace new Agent Trigger creation with "AI Trigger Automation" backed by workflow.
3. Keep legacy entities readable/editable during transition.

### Phase 3: Data Migration

1. Migrate existing `scheduled_tasks` rows into workflows.
2. Migrate existing `agent_triggers` rows into workflows.
3. Preserve references to legacy IDs for audit/debugging.
4. Keep old tables read-only for one release window.

### Phase 4: Cleanup

1. Remove legacy creation routes.
2. Remove legacy template registries.
3. Remove legacy runtime engines after migration confidence is high.

## Compatibility Rules

### Scheduled Task -> Workflow mapping

- `scheduleType` -> workflow trigger
- `actionType` -> one workflow node
- `actionConfig` -> node config
- `enabled` -> workflow status
- `templateId` -> workflow template linkage / metadata

### Agent Trigger -> Workflow mapping

- `triggerType` + schedule/event fields -> workflow trigger(s)
- `promptTemplate` -> `ai_prompt` node config
- `contextTemplate` -> workflow rendering metadata / prompt prelude
- `sourcePluginId` -> workflow metadata

### Run History

Do not attempt to rewrite old run tables into `workflow_runs` in phase 1.

Instead:

- new executions use `workflow_runs`
- old history remains queryable from legacy tables during migration window
- unified UI can display a split adapter view if needed

This reduces migration risk significantly.

## API Direction

Introduce one primary API family for persisted user automations:

- `GET /api/automations`
- `POST /api/automations`
- `PATCH /api/automations/:id`
- `POST /api/automations/:id/trigger`
- `GET /api/automations/:id/runs`

Implementation may still proxy to workflow services at first.

Legacy endpoints remain temporarily:

- `/api/workflows`
- `/api/scheduled-tasks`
- `/api/agent-triggers`

But only one of them should remain the write path for new entities.

## Risks

### 1. Graph model becomes too heavy for simple cases

Mitigation:

- separate authoring UX from persistence model
- use single-node workflow compilation for simple automations

### 2. Template rendering becomes implicit and hard to debug

Mitigation:

- make render context explicit
- preview rendered values before save / run
- record resolved trigger context in run metadata where safe

### 3. Plugin-owned automations lose lifecycle guarantees

Mitigation:

- preserve `sourcePluginId`
- define deletion / disable semantics before migration

### 4. Mixed old/new run history confuses the UI

Mitigation:

- clearly label legacy history
- unify only new executions first

## Open Questions

1. Should unified automations be a renamed Workflow entity, or should we add a thin `automations` API/resource layer on top of Workflow from day one?
2. Should event payload rendering be limited to explicit nodes first, or globally available in all string config fields?
3. Do we want legacy Scheduled Task / Agent Trigger IDs preserved in workflow metadata for reverse lookup?
4. Should plugin-provided automations be editable by users, or only viewable / clonable?
5. Is "once" trigger enough, or do we also need richer calendar semantics before migration?

## Recommended Next Step

Write a follow-up implementation spec for **Phase 0 + Phase 1 only**:

1. fix `agent_task` contract inconsistency
2. add `once` trigger to Workflow
3. add workflow metadata for source/presentation
4. define template rendering contract
5. introduce workflow-backed simple automation creation API

That is the smallest slice that reduces product confusion without forcing a risky big-bang migration.
