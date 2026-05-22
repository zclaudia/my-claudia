import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ExecutorInstanceRepository, ExecutorRegistry, ManualAdapter } from '../index.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { ExecutorService } from '../../issue-orchestration/executor-service.js';
import { createExecutorRoutes } from '../routes.js';
import type { IssueDomainEvent } from '../../issue-orchestration/events.js';

describe('Executor routes', () => {
  let db: Database.Database;
  let app: express.Express;
  let instId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(
      `INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(
      `INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sc', 'proj-1', 'i', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    const registry = new ExecutorRegistry();
    registry.register('manual', (inst) => new ManualAdapter(db, inst));
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const executorService = new ExecutorService({ db, registry, dispatcher });
    instId = new ExecutorInstanceRepository(db).create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'manual',
    }).id;
    app = express();
    app.use('/api/openspec', createExecutorRoutes({ db, executorService }));
  });

  it('GET /executor-instances requires specChangeId', async () => {
    const res = await request(app).get('/api/openspec/executor-instances');
    expect(res.status).toBe(400);
  });

  it('GET /executor-instances lists by spec_change', async () => {
    const res = await request(app).get('/api/openspec/executor-instances?specChangeId=sc');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.executorInstances).toHaveLength(1);
  });

  it('POST /executor-instances/:id/start advances to executing', async () => {
    const res = await request(app)
      .post(`/api/openspec/executor-instances/${instId}/start`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.executorInstance.statusSummary).toBe('executing');
  });

  it('POST /executor-instances/:id/mark-completed -> completed', async () => {
    await request(app).post(`/api/openspec/executor-instances/${instId}/start`).send({});
    const res = await request(app)
      .post(`/api/openspec/executor-instances/${instId}/mark-completed`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.executorInstance.statusSummary).toBe('completed');
  });

  it('POST /executor-instances creates a new manual instance', async () => {
    const res = await request(app).post('/api/openspec/executor-instances').send({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'manual',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.executorInstance.type).toBe('manual');
  });

  it('POST /executor-instances rejects missing fields', async () => {
    const res = await request(app).post('/api/openspec/executor-instances').send({
      projectId: 'proj-1',
    });
    expect(res.status).toBe(400);
  });

  it('GET /executor-instances/:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/openspec/executor-instances/nope');
    expect(res.status).toBe(404);
  });
});
