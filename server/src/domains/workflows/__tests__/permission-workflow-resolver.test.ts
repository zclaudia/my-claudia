import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { PermissionWorkflowResolver } from '../permission-workflow-resolver.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      definition TEXT NOT NULL,
      template_id TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      system_key TEXT,
      source_plugin_id TEXT,
      source_type TEXT,
      authoring_mode TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      provider_id TEXT,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      agent_permission_override TEXT,
      agent TEXT,
      context_sync_status TEXT NOT NULL DEFAULT 'synced',
      review_provider_id TEXT,
      permission_workflow_override_id TEXT,
      is_internal INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE agent_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      project_id TEXT,
      session_id TEXT,
      provider_id TEXT,
      permission_workflow_override_id TEXT,
      permission_policy TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO agent_config (id, enabled, created_at, updated_at) VALUES (1, 1, 1, 1);
  `);
  return db;
}

function insertWorkflow(db: Database.Database, values: {
  id: string;
  status?: string;
  isSystem?: boolean;
  systemKey?: string | null;
  templateId?: string | null;
}) {
  db.prepare(`
    INSERT INTO workflows (
      id, project_id, name, status, definition, template_id, is_system, system_key, created_at, updated_at
    ) VALUES (?, NULL, ?, ?, '{}', ?, ?, ?, 1, 1)
  `).run(
    values.id,
    values.id,
    values.status ?? 'active',
    values.templateId ?? null,
    values.isSystem ? 1 : 0,
    values.systemKey ?? null,
  );
}

describe('PermissionWorkflowResolver', () => {
  let db: Database.Database;
  let resolver: PermissionWorkflowResolver;
  let workflowService: { getSystemPermissionFallback: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    db = createDb();
    workflowService = {
      getSystemPermissionFallback: vi.fn(() => ({
        id: 'wf-system',
        status: 'active',
        isSystem: true,
        systemKey: 'permission_escalation_fallback',
      })),
    };
    resolver = new PermissionWorkflowResolver(db, workflowService as any);
  });

  it('prefers project override over global override', () => {
    insertWorkflow(db, { id: 'wf-project' });
    insertWorkflow(db, { id: 'wf-global' });
    db.prepare(`
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('p1', 'Project', 'code', 'wf-project', 1, 1)
    `).run();
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-global' WHERE id = 1`).run();

    const resolved = resolver.resolve('p1');
    expect(resolved.source).toBe('project_override');
    expect(resolved.workflowId).toBe('wf-project');
  });

  it('falls back to global override when project override is unavailable', () => {
    insertWorkflow(db, { id: 'wf-global' });
    db.prepare(`
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('p1', 'Project', 'code', 'wf-missing', 1, 1)
    `).run();
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-global' WHERE id = 1`).run();

    const resolved = resolver.resolve('p1');
    expect(resolved.source).toBe('global_override');
    expect(resolved.workflowId).toBe('wf-global');
  });

  it('falls back to system fallback when overrides are invalid', () => {
    insertWorkflow(db, { id: 'wf-global', status: 'disabled' });
    db.prepare(`
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('p1', 'Project', 'code', 'wf-missing', 1, 1)
    `).run();
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-global' WHERE id = 1`).run();

    const resolved = resolver.resolve('p1');
    expect(resolved.source).toBe('system_fallback');
    expect(resolved.workflowId).toBe('wf-system');
  });

  it('uses global override when no project is provided', () => {
    insertWorkflow(db, { id: 'wf-global' });
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-global' WHERE id = 1`).run();

    const resolved = resolver.resolve();
    expect(resolved.source).toBe('global_override');
    expect(resolved.workflowId).toBe('wf-global');
  });

  it('ignores system workflow when mistakenly referenced as an override', () => {
    insertWorkflow(db, {
      id: 'wf-system-override',
      isSystem: true,
      systemKey: 'other_system_workflow',
    });
    db.prepare(`
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('p1', 'Project', 'code', 'wf-system-override', 1, 1)
    `).run();
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-system-override' WHERE id = 1`).run();

    const resolved = resolver.resolve('p1');
    expect(resolved.source).toBe('system_fallback');
    expect(resolved.workflowId).toBe('wf-system');
  });
});
