// server/src/domains/openspec/__tests__/bootstrap-review-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { AiExploreService } from '../ai-explore-service.js';
import { BootstrapService } from '../bootstrap-service.js';
import { BootstrapReviewService } from '../bootstrap-review-service.js';

function mkPort(jsonObj: unknown) {
  return {
    async startVirtualRun(args: { onMessage?: (m: { kind: string; content?: string }) => void }) {
      args.onMessage?.({ kind: 'assistant', content: JSON.stringify(jsonObj) });
      args.onMessage?.({ kind: 'run_completed' });
    },
  };
}

const RESCAN_DELTA = {
  perCapability: {
    auth: {
      added: [],
      modified: [
        {
          name: 'Login',
          body: 'System SHALL authenticate with 2FA.',
          scenarios: [
            {
              name: 'with 2FA',
              bodyLines: ['- **WHEN** valid', '- **THEN** prompt 2FA'],
            },
          ],
        },
      ],
      removed: ['Legacy guest login'],
    },
  },
};

async function setupAwaitingReview(db: Database.Database, projectRoot: string) {
  // Seed corpus
  const dir = join(projectRoot, 'openspec', 'specs', 'auth');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    join(dir, 'spec.md'),
    `# auth Specification\n\n## Requirements\n\n### Requirement: Login\n\nSystem SHALL authenticate.\n\n#### Scenario: Valid\n- **WHEN** valid\n- **THEN** SHALL return token\n\n### Requirement: Legacy guest login\n\nUsers MAY browse as guest.\n\n#### Scenario: Guest\n- **WHEN** anon\n- **THEN** allow read-only\n`,
  );
  const explore = new AiExploreService({ aiRunPort: mkPort(RESCAN_DELTA) });
  const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
  const result = await svc.start({ projectId: 'proj-1', mode: 'rescan' });
  expect(result.scan.status).toBe('awaiting_review');
  return result.scan;
}

describe('BootstrapReviewService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let reviewSvc: BootstrapReviewService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'review-'));
    reviewSvc = new BootstrapReviewService({ db, getProjectRoot: () => projectRoot });
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('approve + reject change item status', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    const pending = reviewSvc.listPending(scan.id);
    expect(pending).toHaveLength(2);
    const approved = reviewSvc.approve(pending[0].id);
    const rejected = reviewSvc.reject(pending[1].id);
    expect(approved.status).toBe('approved');
    expect(rejected.status).toBe('rejected');
  });

  it('finalize returns null while pending items remain', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    const result = await reviewSvc.finalize(scan.id);
    expect(result).toBeNull();
  });

  it('finalize after all approved merges modified+removed into corpus', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    const pending = reviewSvc.listPending(scan.id);
    for (const item of pending) reviewSvc.approve(item.id);
    const result = await reviewSvc.finalize(scan.id);
    expect(result).not.toBeNull();
    expect(result!.scan.status).toBe('completed');
    expect(result!.mergedSummary.auth.modified).toBe(1);
    expect(result!.mergedSummary.auth.removed).toBe(1);
    // Corpus reflects merge
    const corpus = fs.readFileSync(
      join(projectRoot, 'openspec', 'specs', 'auth', 'spec.md'),
      'utf-8',
    );
    expect(corpus).toContain('prompt 2FA');
    expect(corpus).not.toContain('Legacy guest login');
  });

  it('finalize after all rejected does NOT change corpus, scan completed with 0 merges', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    const pending = reviewSvc.listPending(scan.id);
    for (const item of pending) reviewSvc.reject(item.id);
    const result = await reviewSvc.finalize(scan.id);
    expect(result!.scan.status).toBe('completed');
    expect(Object.keys(result!.mergedSummary)).toEqual([]);
    const corpus = fs.readFileSync(
      join(projectRoot, 'openspec', 'specs', 'auth', 'spec.md'),
      'utf-8',
    );
    expect(corpus).toContain('System SHALL authenticate.'); // unchanged
    expect(corpus).toContain('Legacy guest login'); // unchanged
  });

  it('finalize bumps corpus meta', async () => {
    const scan = await setupAwaitingReview(db, projectRoot);
    for (const item of reviewSvc.listPending(scan.id)) reviewSvc.approve(item.id);
    await reviewSvc.finalize(scan.id);
    const meta = db
      .prepare(`SELECT * FROM project_spec_corpus_meta WHERE project_id = ?`)
      .get('proj-1') as { initialized: number; last_bootstrap_at: number };
    expect(meta.initialized).toBe(1);
    expect(meta.last_bootstrap_at).toBeGreaterThan(0);
  });

  it('throws on unknown scanId', async () => {
    await expect(reviewSvc.finalize('nope')).rejects.toThrow(/Scan not found/);
  });
});
