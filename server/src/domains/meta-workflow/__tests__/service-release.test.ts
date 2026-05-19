// server/src/domains/meta-workflow/__tests__/service-release.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaWorkflowService, type WorktreeAllocator } from '../service.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  db.prepare(`INSERT INTO projects (id) VALUES (?)`).run('proj-1');
  return db;
}

const samplePhasesJson = JSON.stringify({
  version: '1',
  phases: [{
    id: 'p1', name: 'P1', description: '',
    phaseType: 'code-implement',
    dependsOn: [], inputs: [],
    outputs: [{ kind: 'commit', description: 'a' }],
    acceptanceGates: [{
      id: 'g', description: 'g', command: 'true', expect: { exitCode: 0 },
    }],
  }],
  smokePath: ['p1'],
  metadata: { generatedAt: 0, requirementsPath: 'design/req.md' },
});

describe('MetaWorkflowService — releaseRun on terminal states', () => {
  let db: Database.Database;
  let workdir: string;
  let releaseRunMock: ReturnType<typeof vi.fn>;
  let allocator: WorktreeAllocator;
  let service: MetaWorkflowService;

  beforeEach(() => {
    db = freshDb();
    workdir = mkdtempSync(join(tmpdir(), 'meta-release-'));
    releaseRunMock = vi.fn().mockResolvedValue(undefined);
    allocator = {
      acquire: vi.fn().mockResolvedValue(workdir),
      release: vi.fn().mockResolvedValue(undefined),
      releaseRun: releaseRunMock,
    };
    service = new MetaWorkflowService({
      db,
      runEntityForWorkflow: vi.fn().mockResolvedValue({ exitOk: true }),
      runEntityForSubagent: vi.fn().mockResolvedValue({ exitOk: true }),
      worktreeAllocator: allocator,
    });
  });

  it('cancelRun releases the run slot', () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.cancelRun(run.id);
    expect(releaseRunMock).toHaveBeenCalledWith(run.id);
  });

  it('completing the final phase releases the run slot', async () => {
    const run = service.createRun({ projectId: 'proj-1', title: 't' });
    service.submitRequirements(run.id, 'design/req.md');
    service.approveRequirements(run.id);
    service.setPhasesJson(run.id, samplePhasesJson);
    await service.runPhase(run.id, 'p1');
    // Allow fire-and-forget microtask to settle.
    await Promise.resolve();
    expect(releaseRunMock).toHaveBeenCalledWith(run.id);
  });
});
