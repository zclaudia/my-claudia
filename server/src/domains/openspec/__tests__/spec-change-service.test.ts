// server/src/domains/openspec/__tests__/spec-change-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService } from '../spec-change-service.js';

describe('SpecChangeService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let service: SpecChangeService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    projectRoot = mkdtempSync(path.join(tmpdir(), 'openspec-svc-'));
    service = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('createSpecChange writes the three skeleton files', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'add-2fa', title: 'Add 2FA' });
    const dir = path.join(projectRoot, 'openspec', 'changes', 'add-2fa');
    expect(fs.existsSync(path.join(dir, 'proposal.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'design.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'tasks.md'))).toBe(true);
    expect(sc.status).toBe('drafting');
  });

  it('writeProposal advances status drafting → proposing and persists content', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    const updated = service.writeProposal(sc.id, '# new proposal\n');
    expect(updated.status).toBe('proposing');
    expect(service.readProposal(sc.id)).toBe('# new proposal\n');
  });

  it('writeDesign and writeTasks advance status', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    service.writeProposal(sc.id, 'p');
    let cur = service.writeDesign(sc.id, 'd');
    expect(cur.status).toBe('designing');
    cur = service.writeTasks(sc.id, 't');
    expect(cur.status).toBe('tasks_ready');
  });

  it('status does not regress when writing an earlier artifact', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    service.writeTasks(sc.id, 't');  // tasks_ready
    const updated = service.writeProposal(sc.id, 'p2');
    expect(updated.status).toBe('tasks_ready');  // does not regress to 'proposing'
  });

  it('writeDeltaSpec writes file and adds to deltaSpecPaths', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    const upd = service.writeDeltaSpec(sc.id, 'auth', '# auth delta\n');
    const target = path.join(projectRoot, 'openspec', 'changes', 'x', 'specs', 'auth', 'spec.md');
    expect(fs.existsSync(target)).toBe(true);
    expect(upd.deltaSpecPaths).toContain('openspec/changes/x/specs/auth/spec.md');
  });

  it('writeDeltaSpec twice for same capability does not duplicate path entry', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    service.writeDeltaSpec(sc.id, 'auth', 'a1');
    const upd = service.writeDeltaSpec(sc.id, 'auth', 'a2');
    expect(upd.deltaSpecPaths.filter((p) => p.endsWith('auth/spec.md'))).toHaveLength(1);
  });

  it('cancel sets status=cancelled', () => {
    const sc = service.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' });
    const c = service.cancel(sc.id);
    expect(c.status).toBe('cancelled');
  });

  it('throws when reading from a non-existent spec_change', () => {
    expect(() => service.readProposal('nope')).toThrow(/SpecChange not found/);
  });
});
