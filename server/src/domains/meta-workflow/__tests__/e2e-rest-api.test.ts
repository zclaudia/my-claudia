// server/src/domains/meta-workflow/__tests__/e2e-rest-api.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildHarness, buildLinearPhasesJson, type Harness } from './e2e-harness.js';
import { createMetaWorkflowRoutes } from '../routes.js';

describe('Phase F e2e — REST API integration', () => {
  let h: Harness;
  let app: express.Express;

  beforeEach(() => {
    h = buildHarness();
    app = express();
    app.use(express.json());
    app.use('/api/meta-workflow', createMetaWorkflowRoutes(h.service));
  });

  afterEach(() => {
    h.cleanup();
  });

  it('GET /runs requires projectId', async () => {
    const res = await request(app).get('/api/meta-workflow/runs');
    expect(res.status).toBe(400);
  });

  it('GET /runs?projectId returns the project runs', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'rest-run' });
    const res = await request(app).get('/api/meta-workflow/runs?projectId=proj-1');
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0].id).toBe(run.id);
  });

  it('GET /runs/:runId/phases lists phases after setPhasesJson', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'rest-phases' });
    h.service.submitRequirements(run.id, 'design/requirements.md');
    h.service.approveRequirements(run.id);
    h.service.setPhasesJson(run.id, buildLinearPhasesJson(2));
    const res = await request(app).get(`/api/meta-workflow/runs/${run.id}/phases`);
    expect(res.status).toBe(200);
    expect(res.body.phases.map((p: { phaseId: string }) => p.phaseId)).toEqual(['A', 'B']);
  });

  it('GET /reuse-pool returns empty array initially', async () => {
    const res = await request(app).get('/api/meta-workflow/reuse-pool');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('GET /reuse-pool?phaseType=X applies the filter', async () => {
    h.db.prepare(
      `INSERT INTO meta_workflow_reuse_pool
        (id, kind, entity_id, phase_type, description, tags, source_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('p1', 'workflow', 'w1', 'code-implement', 'A', JSON.stringify(['x']), 'auto', JSON.stringify({ usageCount: 0 }), Date.now());
    h.db.prepare(
      `INSERT INTO meta_workflow_reuse_pool
        (id, kind, entity_id, phase_type, description, tags, source_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('p2', 'workflow', 'w2', 'code-test-write', 'B', JSON.stringify([]), 'auto', JSON.stringify({ usageCount: 0 }), Date.now());

    const res = await request(app).get('/api/meta-workflow/reuse-pool?phaseType=code-test-write');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].entityId).toBe('w2');
  });

  it('POST /runs/:runId/promote-item promotes an auto item', async () => {
    const run = h.service.createRun({ projectId: 'proj-1', title: 'rest-promote' });
    h.db.prepare(
      `INSERT INTO meta_workflow_reuse_pool
        (id, kind, entity_id, phase_type, description, tags, source_type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('to-promote', 'workflow', 'w1', 'code-implement', 'P', JSON.stringify(['auto-generated']), 'auto', JSON.stringify({ usageCount: 0 }), Date.now());

    const res = await request(app)
      .post(`/api/meta-workflow/runs/${run.id}/promote-item`)
      .send({ itemId: 'to-promote', newTags: ['new-tag'], newName: 'X' });
    expect(res.status).toBe(200);
    expect(res.body.item.sourceType).toBe('user');
    expect(res.body.item.tags).toEqual(['new-tag']);
  });
});
