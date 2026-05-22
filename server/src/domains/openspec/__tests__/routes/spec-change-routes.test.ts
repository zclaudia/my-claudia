import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { applyMigrations } from '../../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService } from '../../spec-change-service.js';
import { createSpecChangeRoutes } from '../../routes/spec-change-routes.js';

const noopDrafting = {
  draftProposal: vi.fn(),
  draftDesign: vi.fn(),
  draftTasks: vi.fn(),
  draftDelta: vi.fn(),
} as never;

describe('SpecChange routes', () => {
  let db: Database.Database;
  let projectRoot: string;
  let app: express.Express;
  let svc: SpecChangeService;
  let specChangeId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'sc-routes-'));
    svc = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    specChangeId = svc.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'x', title: 'X' }).id;
    app = express();
    app.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: svc, draftingService: noopDrafting }));
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('GET /spec-changes lists by project', async () => {
    const res = await request(app).get('/api/openspec/spec-changes?projectId=proj-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.specChanges).toHaveLength(1);
  });

  it('GET /spec-changes/:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/openspec/spec-changes/nope');
    expect(res.status).toBe(404);
  });

  it('GET /spec-changes/:id/proposal returns skeleton markdown', async () => {
    const res = await request(app).get(`/api/openspec/spec-changes/${specChangeId}/proposal`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Proposal');
  });

  it('PUT /spec-changes/:id/proposal updates and bumps status', async () => {
    const res = await request(app)
      .put(`/api/openspec/spec-changes/${specChangeId}/proposal`)
      .send({ content: '# new\n' });
    expect(res.status).toBe(200);
    expect(res.body.data.specChange.status).toBe('proposing');
    const get = await request(app).get(`/api/openspec/spec-changes/${specChangeId}/proposal`);
    expect(get.text).toBe('# new\n');
  });

  it('PUT requires content string', async () => {
    const res = await request(app).put(`/api/openspec/spec-changes/${specChangeId}/proposal`).send({});
    expect(res.status).toBe(400);
  });

  it('PUT /spec-changes/:id/delta/:capability writes delta + tracks path', async () => {
    const res = await request(app)
      .put(`/api/openspec/spec-changes/${specChangeId}/delta/auth`)
      .send({ content: '## ADDED Requirements\n' });
    expect(res.status).toBe(200);
    expect(res.body.data.specChange.deltaSpecPaths).toContain('openspec/changes/x/specs/auth/spec.md');
    const get = await request(app).get(`/api/openspec/spec-changes/${specChangeId}/delta/auth`);
    expect(get.status).toBe(200);
    expect(get.text).toContain('ADDED');
  });

  it('GET /spec-changes/:id/delta/:capability returns 404 when not written', async () => {
    const res = await request(app).get(`/api/openspec/spec-changes/${specChangeId}/delta/missing`);
    expect(res.status).toBe(404);
  });

  describe('SpecChange draft routes', () => {
    it('POST /draft-proposal returns drafted content + saves to disk', async () => {
      const draftingService = {
        draftProposal: vi.fn().mockResolvedValue({ content: '# Drafted Proposal\n', rawResponse: '' }),
        draftDesign: vi.fn(),
        draftTasks: vi.fn(),
        draftDelta: vi.fn(),
      };
      const localApp = express();
      localApp.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: svc, draftingService: draftingService as never }));
      const res = await request(localApp).post(`/api/openspec/spec-changes/${specChangeId}/draft-proposal`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.content).toContain('Drafted Proposal');
      expect(res.body.data.specChange.status).toBe('proposing');
      const read = await request(localApp).get(`/api/openspec/spec-changes/${specChangeId}/proposal`);
      expect(read.text).toContain('Drafted Proposal');
    });

    it('POST /draft-delta/:capability writes the delta + tracks path', async () => {
      const draftingService = {
        draftProposal: vi.fn(),
        draftDesign: vi.fn(),
        draftTasks: vi.fn(),
        draftDelta: vi.fn().mockResolvedValue({ content: '## ADDED Requirements\n', rawResponse: '' }),
      };
      const localApp = express();
      localApp.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: svc, draftingService: draftingService as never }));
      const res = await request(localApp).post(`/api/openspec/spec-changes/${specChangeId}/draft-delta/auth`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.specChange.deltaSpecPaths).toContain('openspec/changes/x/specs/auth/spec.md');
      expect(draftingService.draftDelta).toHaveBeenCalledWith(specChangeId, 'auth');
    });

    it('POST /draft-* returns 400 when drafting service throws', async () => {
      const draftingService = {
        draftProposal: vi.fn().mockRejectedValue(new Error('boom')),
        draftDesign: vi.fn(),
        draftTasks: vi.fn(),
        draftDelta: vi.fn(),
      };
      const localApp = express();
      localApp.use('/api/openspec', createSpecChangeRoutes({ db, specChangeService: svc, draftingService: draftingService as never }));
      const res = await request(localApp).post(`/api/openspec/spec-changes/${specChangeId}/draft-proposal`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/boom/);
    });
  });
});
