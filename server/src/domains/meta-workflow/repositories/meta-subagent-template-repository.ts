// server/src/domains/meta-workflow/repositories/meta-subagent-template-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  MetaSubagentTemplate,
  MetaSubagentTerminationCondition,
  ReusePoolSourceType,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<MetaSubagentTemplate, 'id'>;
type Update = {
  name?: string | null;
  systemPrompt?: string;
  allowedTools?: string[];
  maxTurns?: number;
  terminationCondition?: MetaSubagentTerminationCondition;
  sourceType?: ReusePoolSourceType;
  updatedAt?: number;
};

export class MetaSubagentTemplateRepository extends BaseRepository<MetaSubagentTemplate, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_subagent_templates');
  }

  mapRow(raw: unknown): MetaSubagentTemplate {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      name: (row.name as string) || undefined,
      systemPrompt: row.system_prompt as string,
      allowedTools: JSON.parse(row.allowed_tools as string) as string[],
      maxTurns: row.max_turns as number,
      terminationCondition: JSON.parse(row.termination_condition as string) as MetaSubagentTerminationCondition,
      sourceType: row.source_type as ReusePoolSourceType,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_subagent_templates (
        id, name, system_prompt, allowed_tools, max_turns,
        termination_condition, source_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.name ?? null, data.systemPrompt,
        JSON.stringify(data.allowedTools),
        data.maxTurns,
        JSON.stringify(data.terminationCondition),
        data.sourceType,
        data.createdAt, data.updatedAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name ?? null); }
    if (data.systemPrompt !== undefined) { sets.push('system_prompt = ?'); params.push(data.systemPrompt); }
    if (data.allowedTools !== undefined) { sets.push('allowed_tools = ?'); params.push(JSON.stringify(data.allowedTools)); }
    if (data.maxTurns !== undefined) { sets.push('max_turns = ?'); params.push(data.maxTurns); }
    if (data.terminationCondition !== undefined) {
      sets.push('termination_condition = ?');
      params.push(JSON.stringify(data.terminationCondition));
    }
    if (data.sourceType !== undefined) { sets.push('source_type = ?'); params.push(data.sourceType); }
    if (data.updatedAt !== undefined) { sets.push('updated_at = ?'); params.push(data.updatedAt); }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_subagent_templates WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return {
      sql: `UPDATE meta_subagent_templates SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }
}
