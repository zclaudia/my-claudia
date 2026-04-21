/**
 * Permission decision persistence — session-level remembered decisions
 * and project-level allowed outside-workspace roots.
 */
import type { RememberedDecision } from './permission-evaluator.js';
import { buildRememberKey } from './permission-evaluator.js';

export interface PermissionMemoryRow {
  remember_key: string;
  decision: RememberedDecision;
}

export interface PermissionMemoryDb {
  prepare: (sql: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement uses variadic params and returns row types vary by query
    all: (...args: any[]) => Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (...args: any[]) => unknown;
  };
}

export interface OutsideWorkspaceMemoryRow {
  allowed_root: string;
}

export function loadSessionRememberedDecisions(
  db: PermissionMemoryDb,
  sessionId: string
): Map<string, RememberedDecision> {
  const rows = db.prepare(
    'SELECT remember_key, decision FROM permission_memories WHERE session_id = ?'
  ).all(sessionId);
  return new Map(rows.map((row) => [row.remember_key as string, row.decision as RememberedDecision]));
}

export function persistSessionRememberedDecision(
  db: PermissionMemoryDb,
  sessionId: string,
  toolName: string,
  toolInput: unknown,
  detail: string,
  decision: RememberedDecision
): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO permission_memories (session_id, remember_key, decision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, remember_key)
    DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at
  `).run(sessionId, buildRememberKey(toolName, toolInput, detail), decision, now, now);
}

export function loadProjectAllowedOutsideWorkspaceRoots(
  db: PermissionMemoryDb,
  projectId: string
): Set<string> {
  const rows = db.prepare(
    'SELECT allowed_root FROM permission_outside_workspace_roots WHERE project_id = ?'
  ).all(projectId);
  return new Set(rows.map((row) => row.allowed_root as string));
}

export function persistProjectAllowedOutsideWorkspaceRoots(
  db: PermissionMemoryDb,
  projectId: string,
  roots: string[]
): void {
  if (roots.length === 0) return;
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO permission_outside_workspace_roots (project_id, allowed_root, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, allowed_root)
    DO UPDATE SET updated_at = excluded.updated_at
  `);
  for (const root of roots) {
    stmt.run(projectId, root, now, now);
  }
}
