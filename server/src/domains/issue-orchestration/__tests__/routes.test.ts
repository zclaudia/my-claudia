// server/src/domains/issue-orchestration/__tests__/routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService, ArchiveService } from '../../openspec/index.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { IssueLifecycle } from '../issue-lifecycle.js';
import { AnonymousIssueService } from '../anonymous-issue-service.js';
import { createIssueRoutes } from '../routes.js';
import type { IssueDomainEvent } from '../events.js';

describe('Issue routes', () => {
  let db: Database.Database;
  let projectRoot: string;
  let app: express.Express;
  let lifecycle: IssueLifecycle;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'issue-routes-'));
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const archiveService = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    lifecycle = new IssueLifecycle({ db, specChangeService, dispatcher, archiveService });
    const anonymousService = new AnonymousIssueService(lifecycle);
    app = express();
    app.use('/api/issues', createIssueRoutes({ lifecycle, anonymousService }));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('POST /features creates a parent issue', async () => {
    const res = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'Add 2FA' });
    expect(res.status).toBe(201);
    expect(res.body.issue.type).toBe('feature');
  });

  it('POST /sub creates a sub-issue + spec_change', async () => {
    const res = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'Initial flow' });
    expect(res.status).toBe(201);
    expect(res.body.issue.type).toBe('implement');
    expect(res.body.specChange.slug).toBe('initial-flow');
  });

  it('POST /sub rejects type=feature', async () => {
    const res = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'feature', title: 'X' });
    expect(res.status).toBe(400);
  });

  it('POST /anonymous creates anonymous sub-issue', async () => {
    const res = await request(app).post('/api/issues/anonymous').send({ projectId: 'proj-1', title: 'Quick fix' });
    expect(res.status).toBe(201);
    expect(res.body.issue.isAnonymous).toBe(true);
    expect(res.body.issue.parentIssueId).toBeUndefined();
  });

  it('GET /:id returns issue', async () => {
    const create = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'F' });
    const res = await request(app).get(`/api/issues/${create.body.issue.id}`);
    expect(res.status).toBe(200);
    expect(res.body.issue.id).toBe(create.body.issue.id);
  });

  it('GET /:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/issues/nope');
    expect(res.status).toBe(404);
  });

  it('GET /:id/sub-issues lists children', async () => {
    const f = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'F' });
    await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'S', parentIssueId: f.body.issue.id });
    const res = await request(app).get(`/api/issues/${f.body.issue.id}/sub-issues`);
    expect(res.body.subIssues).toHaveLength(1);
  });

  it('PATCH /:id/status transitions', async () => {
    const sub = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'A' });
    const res = await request(app).patch(`/api/issues/${sub.body.issue.id}/status`).send({ status: 'planning' });
    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('planning');
  });

  it('PATCH /:id/status rejects illegal transition', async () => {
    const sub = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'A' });
    const res = await request(app).patch(`/api/issues/${sub.body.issue.id}/status`).send({ status: 'reviewing' });
    expect(res.status).toBe(400);
  });

  it('GET /api/issues lists all issues for a project, newest first', async () => {
    const a = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'A' });
    // small delay to ensure created_at ordering is distinct
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await request(app).post('/api/issues/features').send({ projectId: 'proj-1', title: 'B' });
    const res = await request(app).get('/api/issues?projectId=proj-1');
    expect(res.status).toBe(200);
    expect(res.body.issues.map((i: { id: string }) => i.id)).toEqual([b.body.issue.id, a.body.issue.id]);
  });

  it('GET /api/issues without projectId returns 400', async () => {
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(400);
  });

  it('POST /:id/close-and-archive runs through archive', async () => {
    const sub = await request(app).post('/api/issues/sub').send({ projectId: 'proj-1', type: 'implement', title: 'A' });
    const id = sub.body.issue.id;
    await request(app).patch(`/api/issues/${id}/status`).send({ status: 'planning' });
    await request(app).patch(`/api/issues/${id}/status`).send({ status: 'tasks_ready' });
    await request(app).patch(`/api/issues/${id}/status`).send({ status: 'executing' });
    await request(app).patch(`/api/issues/${id}/status`).send({ status: 'reviewing' });
    const res = await request(app).post(`/api/issues/${id}/close-and-archive`).send({});
    expect(res.status).toBe(200);
    expect(res.body.issue.status).toBe('closed');
    expect(res.body.archive).toBeDefined();
  });
});
