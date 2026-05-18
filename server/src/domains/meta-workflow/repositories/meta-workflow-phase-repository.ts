// server/src/domains/meta-workflow/repositories/meta-workflow-phase-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  MetaWorkflowPhase,
  MetaWorkflowPhaseStatus,
  PhaseType,
  ExecuteEntity,
  PhaseInput,
  PhaseOutput,
  AcceptanceGate,
  PhaseExecuteConfig,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<MetaWorkflowPhase, 'id' | 'startedAt' | 'completedAt'>;
type Update = {
  phaseType?: MetaWorkflowPhase['phaseType'];
  status?: MetaWorkflowPhase['status'];
  executeEntity?: MetaWorkflowPhase['executeEntity'];
  reusedFromPoolId?: string | null;
  generatedWorkflowId?: string | null;
  generatedSubagentId?: string | null;
  currentRunId?: string | null;
  worktreePath?: string | null;
  staleSince?: number | null;
  staleSourcePhaseId?: string | null;
  attempt?: number;
  maxRetries?: number;
  inputsSnapshot?: MetaWorkflowPhase['inputsSnapshot'] | null;
  outputsSnapshot?: MetaWorkflowPhase['outputsSnapshot'] | null;
  gatesSnapshot?: MetaWorkflowPhase['gatesSnapshot'] | null;
  executeConfigSnapshot?: MetaWorkflowPhase['executeConfigSnapshot'] | null;
  synthesizerProviderId?: string | null;
  runtimeProviderId?: string | null;
  startedAt?: number;
  completedAt?: number;
};

function parseJsonOrUndefined<T>(s: unknown): T | undefined {
  return s ? (JSON.parse(s as string) as T) : undefined;
}

export class MetaWorkflowPhaseRepository extends BaseRepository<MetaWorkflowPhase, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_workflow_phases');
  }

  mapRow(raw: unknown): MetaWorkflowPhase {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      runId: row.run_id as string,
      phaseId: row.phase_id as string,
      phaseType: row.phase_type as PhaseType,
      status: row.status as MetaWorkflowPhaseStatus,
      executeEntity: row.execute_entity as ExecuteEntity,
      reusedFromPoolId: (row.reused_from_pool_id as string) || undefined,
      generatedWorkflowId: (row.generated_workflow_id as string) || undefined,
      generatedSubagentId: (row.generated_subagent_id as string) || undefined,
      currentRunId: (row.current_run_id as string) || undefined,
      worktreePath: (row.worktree_path as string) || undefined,
      staleSince: (row.stale_since as number) || undefined,
      staleSourcePhaseId: (row.stale_source_phase_id as string) || undefined,
      attempt: row.attempt as number,
      maxRetries: row.max_retries as number,
      inputsSnapshot: parseJsonOrUndefined<PhaseInput[]>(row.inputs_snapshot),
      outputsSnapshot: parseJsonOrUndefined<PhaseOutput[]>(row.outputs_snapshot),
      gatesSnapshot: parseJsonOrUndefined<AcceptanceGate[]>(row.gates_snapshot),
      executeConfigSnapshot: parseJsonOrUndefined<PhaseExecuteConfig>(row.execute_config_snapshot),
      synthesizerProviderId: (row.synthesizer_provider_id as string) || undefined,
      runtimeProviderId: (row.runtime_provider_id as string) || undefined,
      createdAt: row.created_at as number,
      startedAt: (row.started_at as number) || undefined,
      completedAt: (row.completed_at as number) || undefined,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_workflow_phases (
        id, run_id, phase_id, phase_type, status, execute_entity,
        reused_from_pool_id, generated_workflow_id, generated_subagent_id,
        current_run_id, worktree_path, stale_since, stale_source_phase_id,
        attempt, max_retries,
        inputs_snapshot, outputs_snapshot, gates_snapshot, execute_config_snapshot,
        synthesizer_provider_id, runtime_provider_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.runId, data.phaseId, data.phaseType, data.status, data.executeEntity,
        data.reusedFromPoolId ?? null,
        data.generatedWorkflowId ?? null,
        data.generatedSubagentId ?? null,
        data.currentRunId ?? null,
        data.worktreePath ?? null,
        data.staleSince ?? null,
        data.staleSourcePhaseId ?? null,
        data.attempt, data.maxRetries,
        data.inputsSnapshot ? JSON.stringify(data.inputsSnapshot) : null,
        data.outputsSnapshot ? JSON.stringify(data.outputsSnapshot) : null,
        data.gatesSnapshot ? JSON.stringify(data.gatesSnapshot) : null,
        data.executeConfigSnapshot ? JSON.stringify(data.executeConfigSnapshot) : null,
        data.synthesizerProviderId ?? null,
        data.runtimeProviderId ?? null,
        data.createdAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    const jsonFields = new Set<keyof Update>([
      'inputsSnapshot', 'outputsSnapshot', 'gatesSnapshot', 'executeConfigSnapshot',
    ]);

    const fieldMap: Array<[keyof Update, string]> = [
      ['phaseType', 'phase_type'],
      ['status', 'status'],
      ['executeEntity', 'execute_entity'],
      ['reusedFromPoolId', 'reused_from_pool_id'],
      ['generatedWorkflowId', 'generated_workflow_id'],
      ['generatedSubagentId', 'generated_subagent_id'],
      ['currentRunId', 'current_run_id'],
      ['worktreePath', 'worktree_path'],
      ['staleSince', 'stale_since'],
      ['staleSourcePhaseId', 'stale_source_phase_id'],
      ['attempt', 'attempt'],
      ['maxRetries', 'max_retries'],
      ['inputsSnapshot', 'inputs_snapshot'],
      ['outputsSnapshot', 'outputs_snapshot'],
      ['gatesSnapshot', 'gates_snapshot'],
      ['executeConfigSnapshot', 'execute_config_snapshot'],
      ['synthesizerProviderId', 'synthesizer_provider_id'],
      ['runtimeProviderId', 'runtime_provider_id'],
      ['startedAt', 'started_at'],
      ['completedAt', 'completed_at'],
    ];

    for (const [key, col] of fieldMap) {
      if (data[key] !== undefined) {
        sets.push(`${col} = ?`);
        const value = data[key];
        if (jsonFields.has(key)) {
          params.push(value === null ? null : JSON.stringify(value));
        } else {
          params.push(value ?? null);
        }
      }
    }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_workflow_phases WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return {
      sql: `UPDATE meta_workflow_phases SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByRun(runId: string): MetaWorkflowPhase[] {
    const rows = this.db.prepare(
      `SELECT * FROM meta_workflow_phases WHERE run_id = ? ORDER BY created_at ASC`,
    ).all(runId);
    return rows.map((r) => this.mapRow(r));
  }

  findByRunAndPhaseId(runId: string, phaseId: string): MetaWorkflowPhase | null {
    const row = this.db.prepare(
      `SELECT * FROM meta_workflow_phases WHERE run_id = ? AND phase_id = ? LIMIT 1`,
    ).get(runId, phaseId);
    return row ? this.mapRow(row) : null;
  }
}
