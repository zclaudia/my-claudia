import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createCorpusRoutes } from '../../routes/corpus-routes.js';

const SPEC = `# auth Specification

## Requirements
### Requirement: Login
System MUST authenticate.

#### Scenario: Valid
- **WHEN** valid
- **THEN** SHALL return token
`;

describe('Corpus routes', () => {
  let app: express.Express;
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'corpus-'));
    app = express();
    app.use('/api/openspec', createCorpusRoutes({ getProjectRoot: () => projectRoot }));
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('GET /corpus requires projectId', async () => {
    const res = await request(app).get('/api/openspec/corpus');
    expect(res.status).toBe(400);
  });

  it('GET /corpus returns empty list when openspec/specs/ missing', async () => {
    const res = await request(app).get('/api/openspec/corpus?projectId=p1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.capabilities).toEqual([]);
  });

  it('GET /corpus lists capabilities with counts', async () => {
    const dir = join(projectRoot, 'openspec', 'specs', 'auth');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.md'), SPEC);
    const res = await request(app).get('/api/openspec/corpus?projectId=p1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.capabilities).toHaveLength(1);
    expect(res.body.data.capabilities[0].capability).toBe('auth');
    expect(res.body.data.capabilities[0].requirementCount).toBe(1);
    expect(res.body.data.capabilities[0].scenarioCount).toBe(1);
  });

  it('GET /corpus/:capability returns parsed + raw', async () => {
    const dir = join(projectRoot, 'openspec', 'specs', 'auth');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'spec.md'), SPEC);
    const res = await request(app).get('/api/openspec/corpus/auth?projectId=p1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.capability).toBe('auth');
    expect(res.body.data.raw).toBe(SPEC);
    expect(res.body.data.parsed.requirements[0].name).toBe('Login');
  });

  it('GET /corpus/:capability returns 404 when capability missing', async () => {
    const res = await request(app).get('/api/openspec/corpus/missing?projectId=p1');
    expect(res.status).toBe(404);
  });

  it('returns 400 when getProjectRoot throws', async () => {
    const app2 = express();
    app2.use('/api/openspec', createCorpusRoutes({ getProjectRoot: () => { throw new Error('no root'); } }));
    const res = await request(app2).get('/api/openspec/corpus?projectId=p1');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no root/);
  });
});
