import { describe, it, expect } from 'vitest';
import type {
  PhaseDef, PhasesDoc, AcceptanceGate, PhaseInput, PhaseOutput,
  MetaWorkflowRun, MetaWorkflowPhase, MetaWorkflowArtifact,
  ReusablePoolItem, MetaSubagentTemplate, MetaWorkflowConfig,
  MetaWorkflowRunStatus, MetaWorkflowPhaseStatus, PhaseType, ExecuteEntity,
  ExecutePattern,
} from '../meta-workflow.js';
import {
  PHASE_TYPES, EXECUTE_ENTITIES, EXECUTE_PATTERNS,
  META_WORKFLOW_RUN_STATUSES, META_WORKFLOW_PHASE_STATUSES,
} from '../meta-workflow.js';

describe('meta-workflow types', () => {
  it('PHASE_TYPES enum has exactly 6 values', () => {
    expect(PHASE_TYPES).toEqual([
      'code-implement', 'code-refactor', 'code-test-write',
      'design-doc', 'dep-update', 'investigation',
    ]);
  });

  it('EXECUTE_ENTITIES has workflow + subagent', () => {
    expect(EXECUTE_ENTITIES).toEqual(['workflow', 'subagent']);
  });

  it('EXECUTE_PATTERNS has 3 patterns', () => {
    expect(EXECUTE_PATTERNS).toEqual(['single-shot', 'multi-step', 'self-healing']);
  });

  it('a minimal PhaseDef is shape-compatible', () => {
    const phase: PhaseDef = {
      id: 'impl-user-service',
      name: 'Implement UserService',
      description: 'Wire up the UserServiceImpl behind IUserService',
      phaseType: 'code-implement',
      dependsOn: [],
      inputs: [],
      outputs: [{ kind: 'commit', description: 'feature commit' }],
      acceptanceGates: [{
        id: 'compile',
        description: 'project must compile',
        command: 'mvn compile -q',
        expect: { exitCode: 0 },
      }],
    };
    expect(phase.phaseType).toBe('code-implement');
  });

  it('a PhasesDoc carries smokePath + metadata', () => {
    const doc: PhasesDoc = {
      version: '1',
      phases: [],
      smokePath: ['phase-1', 'phase-2'],
      metadata: { generatedAt: 1, requirementsPath: 'design/requirements.md' },
    };
    expect(doc.version).toBe('1');
  });

  it('MetaWorkflowRun status enum', () => {
    expect(META_WORKFLOW_RUN_STATUSES).toContain('requirement_draft');
    expect(META_WORKFLOW_RUN_STATUSES).toContain('executing');
    expect(META_WORKFLOW_RUN_STATUSES).toContain('completed');
  });

  it('MetaWorkflowPhase status enum', () => {
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('searching_reuse');
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('generating');
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('verifying_gates');
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('done');
    expect(META_WORKFLOW_PHASE_STATUSES).toContain('stale');
  });

  it('AcceptanceGate.expect supports stdout regex and file existence', () => {
    const gate: AcceptanceGate = {
      id: 'has-report',
      description: 'investigation report must exist',
      command: 'test -s investigation-report.md',
      expect: { exitCode: 0, fileExists: ['investigation-report.md'] },
    };
    expect(gate.expect.fileExists).toContain('investigation-report.md');
  });
});
