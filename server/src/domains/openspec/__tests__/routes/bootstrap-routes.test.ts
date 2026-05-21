// server/src/domains/openspec/__tests__/routes/bootstrap-routes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import {
  AiExploreService,
  BootstrapService,
  BootstrapReviewService,
} from '../../index.js';
import { createBootstrapRoutes } from '../../routes/bootstrap-routes.js';

function mkPort(jsonObj: unknown) {
  return {
    async startVirtualRun(args: {
      onMessage?: (m: { kind: string; content?: string }) => void;
    }) {
      args.onMessage?.({ kind: 'assistant', content: JSON.stringify(jsonObj) });
      args.onMessage?.({ kind: 'run_completed' });
    },
  };
}

describe('Bootstrap routes', () => {
  let db: Database.Database;
  let projectRoot: string;
  let app: express.Express;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'bootstrap-routes-'));
    const explore = new AiExploreService({
      aiRunPort: mkPort({
        perCapability: {
          auth: {
            added: [
              {
                name: 'A',
                body: 'MUST',
                scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
              },
            ],
            modified: [],
            removed: [],
          },
        },
      }),
    });
    const bootstrapService = new BootstrapService({
      db,
      explore,
      getProjectRoot: () => projectRoot,
    });
    const reviewService = new BootstrapReviewService({
      db,
      getProjectRoot: () => projectRoot,
    });
    app = express();
    app.use('/api/openspec', createBootstrapRoutes({ db, bootstrapService, reviewService }));
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('POST /bootstrap/scans starts a scan', async () => {
    const res = await request(app)
      .post('/api/openspec/bootstrap/scans')
      .send({ projectId: 'proj-1', mode: 'initial' });
    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe('completed');
    expect(res.body.scan.appliedCount).toBe(1);
  });

  it('POST /bootstrap/scans rejects invalid mode', async () => {
    const res = await request(app)
      .post('/api/openspec/bootstrap/scans')
      .send({ projectId: 'proj-1', mode: 'wrong' });
    expect(res.status).toBe(400);
  });

  it('GET /bootstrap/scans lists', async () => {
    await request(app)
      .post('/api/openspec/bootstrap/scans')
      .send({ projectId: 'proj-1', mode: 'initial' });
    const res = await request(app).get('/api/openspec/bootstrap/scans?projectId=proj-1');
    expect(res.body.scans).toHaveLength(1);
  });

  it('GET /bootstrap/scans/:id returns 404 for unknown', async () => {
    const res = await request(app).get('/api/openspec/bootstrap/scans/nope');
    expect(res.status).toBe(404);
  });

  it('GET /bootstrap/scans/:id/items lists items', async () => {
    const start = await request(app)
      .post('/api/openspec/bootstrap/scans')
      .send({ projectId: 'proj-1', mode: 'initial' });
    const id = start.body.scan.id;
    const res = await request(app).get(`/api/openspec/bootstrap/scans/${id}/items`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('POST /bootstrap/scans/:id/finalize returns 409 when items pending', async () => {
    const start = await request(app)
      .post('/api/openspec/bootstrap/scans')
      .send({ projectId: 'proj-1', mode: 'initial' });
    const id = start.body.scan.id;
    db.prepare(`UPDATE bootstrap_scans SET status='awaiting_review' WHERE id = ?`).run(id);
    db.prepare(
      `INSERT INTO bootstrap_review_items (id, scan_id, capability, operation, payload_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('it', id, 'cap', 'modify', '{}', 'pending', Date.now());
    const res = await request(app).post(`/api/openspec/bootstrap/scans/${id}/finalize`).send({});
    expect(res.status).toBe(409);
  });

  it('POST /bootstrap/items/:itemId/approve marks approved', async () => {
    const start = await request(app)
      .post('/api/openspec/bootstrap/scans')
      .send({ projectId: 'proj-1', mode: 'initial' });
    db.prepare(
      `INSERT INTO bootstrap_review_items (id, scan_id, capability, operation, payload_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'it',
      start.body.scan.id,
      'cap',
      'modify',
      '{"name":"x","body":"MUST","scenarios":[{"name":"s","bodyLines":["- **WHEN** x"]}]}',
      'pending',
      Date.now(),
    );
    const res = await request(app).post('/api/openspec/bootstrap/items/it/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.item.status).toBe('approved');
  });
});
