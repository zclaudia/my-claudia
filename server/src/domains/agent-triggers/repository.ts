import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { AgentTrigger } from '@my-claudia/shared';

interface TriggerRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  trigger_type: string;
  event_pattern: string | null;
  event_filter: string | null;
  prompt_template: string;
  provider_id: string | null;
  project_id: string | null;
  context_template: string | null;
  feed_delivery: number;
  notify_delivery: number;
  source_plugin_id: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTrigger(row: TriggerRow): AgentTrigger {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled === 1,
    triggerType: row.trigger_type as AgentTrigger['triggerType'],
    eventPattern: row.event_pattern ?? undefined,
    eventFilter: row.event_filter ? JSON.parse(row.event_filter) : undefined,
    promptTemplate: row.prompt_template,
    providerId: row.provider_id ?? undefined,
    projectId: row.project_id ?? undefined,
    contextTemplate: row.context_template ?? undefined,
    feedDelivery: row.feed_delivery === 1,
    notifyDelivery: row.notify_delivery === 1,
    sourcePluginId: row.source_plugin_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgentTriggerRepository {
  constructor(private db: Database.Database) {}

  create(trigger: Omit<AgentTrigger, 'id' | 'createdAt' | 'updatedAt'>): AgentTrigger {
    const id = uuidv4();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO agent_triggers (id, name, description, enabled, trigger_type, event_pattern, event_filter, prompt_template, provider_id, project_id, context_template, feed_delivery, notify_delivery, source_plugin_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, trigger.name, trigger.description ?? null,
      trigger.enabled ? 1 : 0, trigger.triggerType,
      trigger.eventPattern ?? null,
      trigger.eventFilter ? JSON.stringify(trigger.eventFilter) : null,
      trigger.promptTemplate,
      trigger.providerId ?? null, trigger.projectId ?? null,
      trigger.contextTemplate ?? 'agent',
      trigger.feedDelivery ? 1 : 0, trigger.notifyDelivery ? 1 : 0,
      trigger.sourcePluginId ?? null,
      now, now,
    );
    return { ...trigger, id, createdAt: now, updatedAt: now };
  }

  findAll(): AgentTrigger[] {
    const rows = this.db.prepare('SELECT * FROM agent_triggers ORDER BY created_at DESC').all() as TriggerRow[];
    return rows.map(rowToTrigger);
  }

  findEnabled(): AgentTrigger[] {
    const rows = this.db.prepare('SELECT * FROM agent_triggers WHERE enabled = 1').all() as TriggerRow[];
    return rows.map(rowToTrigger);
  }

  findById(id: string): AgentTrigger | undefined {
    const row = this.db.prepare('SELECT * FROM agent_triggers WHERE id = ?').get(id) as TriggerRow | undefined;
    return row ? rowToTrigger(row) : undefined;
  }

  update(id: string, updates: Partial<AgentTrigger>): void {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
    if (updates.eventPattern !== undefined) { fields.push('event_pattern = ?'); values.push(updates.eventPattern); }
    if (updates.promptTemplate !== undefined) { fields.push('prompt_template = ?'); values.push(updates.promptTemplate); }
    if (updates.providerId !== undefined) { fields.push('provider_id = ?'); values.push(updates.providerId); }
    if (updates.feedDelivery !== undefined) { fields.push('feed_delivery = ?'); values.push(updates.feedDelivery ? 1 : 0); }
    if (updates.notifyDelivery !== undefined) { fields.push('notify_delivery = ?'); values.push(updates.notifyDelivery ? 1 : 0); }

    if (fields.length === 0) return;
    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    this.db.prepare(`UPDATE agent_triggers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM agent_triggers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  findByPluginId(pluginId: string): AgentTrigger[] {
    const rows = this.db.prepare('SELECT * FROM agent_triggers WHERE source_plugin_id = ?').all(pluginId) as TriggerRow[];
    return rows.map(rowToTrigger);
  }

  deleteByPluginId(pluginId: string): number {
    const result = this.db.prepare('DELETE FROM agent_triggers WHERE source_plugin_id = ?').run(pluginId);
    return result.changes;
  }
}
