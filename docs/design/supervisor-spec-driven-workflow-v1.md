# Supervisor Spec-Driven Workflow v1

## Background

`Supervisor` should not be positioned as a heavier general chat mode.

Its value is managing **long-running project changes** that span multiple sessions, require explicit scope control, and need durable progress tracking. Typical examples:

- large feature delivery
- legacy refactors
- architecture migrations
- multi-phase reliability or performance work

Small and self-contained tasks should remain in normal session mode.

This design borrows the useful structure of OpenSpec, but adapts it to MyClaudia's existing project, task, session, review, and checkpoint model instead of copying the CLI workflow directly.

## Positioning

`Supervisor` becomes a **spec-driven execution workspace** for project-level initiatives.

It is responsible for:

1. establishing a durable project baseline
2. defining a change goal and design scope
3. decomposing the change into executable tasks
4. supervising execution across multiple sessions
5. validating outcomes and syncing project specs

It is not responsible for replacing normal sessions for everyday coding.

## Goals

1. Give large changes a durable source of truth beyond chat history.
2. Preserve continuity across many sessions and task runs.
3. Make execution bounded by explicit design scope and acceptance criteria.
4. Keep project docs and implementation state synchronized over time.
5. Reuse the current supervision domain instead of introducing a second orchestration system.

## Non-Goals

1. Force all coding work into supervisor mode.
2. Recreate the full OpenSpec CLI and command generation system.
3. Require fully formal specs for every project change.
4. Replace the existing normal session workflow for fast iteration.

## Product Model

Supervisor v1 should manage three primary objects:

### 1. Project Baseline

A durable description of the project as it exists now.

Contents:

- business and product background
- current goals and constraints
- architecture overview
- key modules and ownership boundaries
- current feature inventory
- glossary / domain language

For an existing project, the baseline can be initialized by AI through codebase analysis, then refined by the user over time.

### 2. Change

A long-running initiative tracked inside a supervised project.

Examples:

- "Add team-based billing"
- "Refactor sync engine to job-based pipeline"
- "Modernize old settings page and split state management"

Each change contains:

- goal
- motivation
- non-goals
- affected scope
- design
- acceptance criteria
- task plan
- status

### 3. Task

A concrete executable unit under a change.

Each task must have:

- explicit scope
- dependency information
- execution context
- verification method
- completion state

## Why A Change Layer Is Required

The current supervision model already has `ProjectAgent` and `SupervisionTask`, but task-level orchestration alone is not enough for large work.

Without a first-class `Change` object:

- tasks lose the rationale for why they exist
- design scope becomes fragmented across chat and task descriptions
- acceptance becomes ambiguous at the initiative level
- spec syncing has no stable target

Therefore `Change` should become the main planning container between `Project` and `Task`.

## Workflow

Supervisor v1 should use five top-level phases.

### Phase 1: Baseline

Initialize or refresh the project baseline.

For new projects:

- user provides background, goals, and constraints

For existing projects:

- AI scans the repository
- AI generates an initial markdown baseline
- user reviews and corrects important assumptions

This phase is low-frequency. It should not be repeated for every change.

### Phase 2: Change

Create a new change initiative.

This is similar to OpenSpec `propose`, but native to supervisor.

Required output:

- change title
- problem statement
- motivation
- non-goals
- impact surface
- success criteria

### Phase 3: Design

Define the technical approach before task execution.

Required output:

- modules expected to change
- explicit out-of-scope areas
- implementation strategy
- data flow / architecture notes
- migration or rollout notes if needed
- testing strategy
- acceptance criteria

This phase ends with a **design review gate**. Execution should not start until the design is accepted.

### Phase 4: Execution

Break the change into tasks and run them under supervision.

Supervisor responsibilities:

- task planning and dependency management
- session creation and reuse
- checkpointing
- review and retry
- pause / resume for long-running work
- progress summarization

This phase may run across many days and many sessions.

### Phase 5: Sync

After accepted execution results, sync implementation back into specs.

Examples:

- update feature docs
- update architecture docs
- update baseline summaries
- mark change as completed

This phase prevents the system from becoming "spec first, drift later".

## State Model

The current `ProjectAgent.phase` model can remain, but `Supervisor` should expose a change-oriented state machine in the product layer.

Recommended change states:

```ts
type ChangeStatus =
  | 'draft'
  | 'designing'
  | 'awaiting_design_review'
  | 'planned'
  | 'executing'
  | 'paused'
  | 'accepting'
  | 'syncing'
  | 'completed'
  | 'cancelled';
```

Recommended task states continue to reuse the existing supervision task lifecycle where possible:

- `proposed`
- `pending`
- `queued`
- `planning`
- `running`
- `reviewing`
- `approved`
- `integrated`
- `rejected`
- `blocked`
- `failed`
- `cancelled`

## File Model

Supervisor should adopt a durable file-backed context similar in spirit to OpenSpec, but shaped around MyClaudia's existing `.supervision/` directory.

Recommended structure:

```text
.supervision/
├── baseline/
│   ├── project.md
│   ├── architecture.md
│   ├── glossary.md
│   └── features/
│       └── <feature>.md
├── changes/
│   └── <change-id>/
│       ├── change.md
│       ├── design.md
│       ├── tasks.md
│       ├── acceptance.md
│       └── sync-log.md
├── summaries/
│   └── project-summary.md
└── workflow.yaml
```

Notes:

- `baseline/` is project-level and long-lived
- `changes/<change-id>/` is the execution container for one initiative
- `project-summary.md` remains the lightweight context injection source
- existing supervision runtime can continue to inject only the minimal summary by default and load detailed files on demand

## Data Model Additions

Shared types should gain a new `Change` entity.

Draft shape:

```ts
interface ProjectChange {
  id: string;
  projectId: string;
  title: string;
  status: ChangeStatus;
  summary: string;
  motivation?: string;
  nonGoals: string[];
  scope: string[];
  acceptanceCriteria: string[];
  baselineVersion?: string;
  designApprovedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}
```

`SupervisionTask` should reference a change:

```ts
interface SupervisionTask {
  // existing fields...
  changeId?: string;
  changeTaskRef?: string; // e.g. section or task key in tasks.md
}
```

## Integration With Existing Supervision Domain

This design should extend the current supervision domain rather than replace it.

### Existing pieces that can be reused

- `ProjectAgent` and project-level supervisor enablement
- `SupervisionTask` lifecycle and scheduling
- checkpoint engine
- review engine
- task runner
- context manager
- task board UI

### New pieces required

1. `Change` repository and API
2. baseline initialization flow
3. design review gate
4. change-aware context assembly
5. spec sync engine

## Prompt / Context Changes

Task execution should no longer rely only on generic project context plus task description.

For supervised tasks under a change, context injection should include:

- project summary
- relevant baseline snippets
- change summary
- approved design summary
- the specific task item from `tasks.md`
- acceptance criteria for the task and the overall change
- prior review feedback

This is the most valuable OpenSpec-inspired improvement for execution quality.

## UX Flow

Recommended product flow:

1. User enables supervisor mode for a project.
2. App asks whether to initialize a baseline from user input or by codebase analysis.
3. User creates a new change.
4. Supervisor helps draft `change.md`.
5. Supervisor helps draft `design.md`.
6. User reviews and approves design.
7. Supervisor generates `tasks.md`.
8. Supervisor executes tasks over time.
9. Completed work enters acceptance.
10. Accepted results are synced back into baseline/spec files.

## Acceptance Model

Acceptance should happen at two levels.

### Task-Level Acceptance

For each task:

- did the code change match the intended scope?
- did verification pass?
- were review issues resolved?

### Change-Level Acceptance

For the full initiative:

- did the implemented result satisfy the declared success criteria?
- did the design assumptions hold?
- do specs now match the new system state?

This avoids the common failure mode where every task passes but the initiative still drifts.

## MVP Recommendation

The first version should stay narrow.

### MVP In Scope

1. project baseline initialization
2. first-class change entity
3. `change.md`, `design.md`, `tasks.md` generation
4. design approval gate before execution
5. tasks linked to a change
6. sync completed change results back into markdown files

### MVP Out Of Scope

1. automatic change discovery from arbitrary chats
2. advanced branching / multiple concurrent changes per project with merge management
3. fully automated baseline maintenance
4. rich diagrams or visual editors
5. OpenSpec CLI compatibility

## Risks

### 1. Process Weight

If every change requires too much ceremony, users will avoid supervisor mode.

Mitigation:

- reserve supervisor for long-running work only
- keep normal session mode unchanged
- allow lighter change templates later

### 2. Spec Drift

Generated baseline and design docs can become stale.

Mitigation:

- record sync points explicitly
- keep summaries concise
- require spec sync before marking a change complete

### 3. AI Inference Errors In Legacy Projects

Reverse-engineered baseline docs may contain guesses.

Mitigation:

- mark inferred sections clearly
- separate user-confirmed facts from AI-inferred observations

### 4. Duplicate Sources Of Truth

If `.supervision/plans` and change specs evolve independently, the model becomes confusing.

Mitigation:

- make `changes/<change-id>/` the canonical source for spec-driven work
- gradually reduce special-case plan files for supervised tasks

## Open Questions

1. Should `Change` be persisted only in markdown, or also in SQLite with file sync?
2. Should one project support multiple active changes in v1, or only one active change at a time?
3. Should baseline refresh be manual-only in v1?
4. Should design approval be explicit user action only, or allow trusted auto-approval modes later?

## Recommendation

This workflow is reasonable and aligned with the intended positioning of supervisor mode.

The key product decision is:

`Supervisor` should be the home for **heavy, long-running, spec-driven work**, while normal sessions remain the default path for smaller tasks.

With that positioning, the right implementation strategy is not "embed OpenSpec into MyClaudia", but:

**promote OpenSpec's planning structure into a native supervisor workflow built on top of the existing supervision domain.**
