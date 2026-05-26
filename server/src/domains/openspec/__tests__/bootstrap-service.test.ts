// server/src/domains/openspec/__tests__/bootstrap-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { AiExploreService } from '../ai-explore-service.js';
import { BootstrapService } from '../bootstrap-service.js';
import { BootstrapReviewItemRepository } from '../repositories/bootstrap-review-item-repository.js';

function mkPort(jsonObj: unknown) {
  return {
    async startVirtualRun(args: { onMessage?: (m: { kind: string; content?: string }) => void }) {
      args.onMessage?.({ kind: 'assistant', content: JSON.stringify(jsonObj) });
      args.onMessage?.({ kind: 'run_completed' });
    },
  };
}

describe('BootstrapService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let reviewRepo: BootstrapReviewItemRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'bootstrap-'));
    reviewRepo = new BootstrapReviewItemRepository(db);
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('initial bootstrap auto-applies all ADDED and marks scan completed', async () => {
    const explore = new AiExploreService({
      aiRunPort: mkPort({
        perCapability: {
          auth: {
            added: [
              {
                name: 'Login',
                body: 'System MUST authenticate.',
                scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
              },
            ],
            modified: [],
            removed: [],
          },
          billing: {
            added: [
              {
                name: 'Charge',
                body: 'System SHALL charge.',
                scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
              },
            ],
            modified: [],
            removed: [],
          },
        },
      }),
    });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });

    const result = await svc.start({ projectId: 'proj-1', mode: 'initial' });
    expect(result.scan.status).toBe('completed');
    expect(result.scan.appliedCount).toBe(2);
    expect(result.scan.pendingCount).toBe(0);
    expect(result.appliedSummary).toEqual({ auth: 1, billing: 1 });
    expect(fs.existsSync(join(projectRoot, 'openspec', 'specs', 'auth', 'spec.md'))).toBe(true);
    expect(fs.existsSync(join(projectRoot, 'openspec', 'specs', 'billing', 'spec.md'))).toBe(true);
    // corpus meta bumped
    const meta = db
      .prepare(`SELECT * FROM project_spec_corpus_meta WHERE project_id = ?`)
      .get('proj-1') as { initialized: number; last_bootstrap_at: number };
    expect(meta.initialized).toBe(1);
    expect(meta.last_bootstrap_at).toBeGreaterThan(0);
  });

  it('re-scan with MODIFIED + REMOVED queues them for review (status=awaiting_review)', async () => {
    // Seed an existing corpus first.
    const corpusDir = join(projectRoot, 'openspec', 'specs', 'auth');
    fs.mkdirSync(corpusDir, { recursive: true });
    fs.writeFileSync(
      join(corpusDir, 'spec.md'),
      `# auth Specification\n\n## Requirements\n\n### Requirement: Login\n\nSystem SHALL authenticate.\n\n#### Scenario: Valid\n- **WHEN** valid\n- **THEN** SHALL return token\n`,
    );

    const explore = new AiExploreService({
      aiRunPort: mkPort({
        perCapability: {
          auth: {
            added: [
              {
                name: '2FA',
                body: 'System SHALL support 2FA.',
                scenarios: [{ name: 'enroll', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
              },
            ],
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
      }),
    });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });

    const result = await svc.start({ projectId: 'proj-1', mode: 'rescan' });
    expect(result.scan.status).toBe('awaiting_review');
    expect(result.scan.appliedCount).toBe(1); // only 2FA ADDED
    expect(result.scan.pendingCount).toBe(2); // Login MODIFIED + Legacy REMOVED
    // corpus has Login + 2FA but Login is still the OLD body (delta not applied yet)
    const corpus = fs.readFileSync(join(corpusDir, 'spec.md'), 'utf-8');
    expect(corpus).toContain('2FA');
    expect(corpus).toContain('### Requirement: Login');
    expect(corpus).toContain('System SHALL authenticate.'); // old body, unchanged
    expect(corpus).not.toContain('2FA prompt'); // new body NOT yet applied

    // Review items persisted
    const pending = reviewRepo.listPendingByScan(result.scan.id);
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.operation).sort()).toEqual(['modify', 'remove']);
  });

  it('throws when another scan is already active', async () => {
    const explore = new AiExploreService({ aiRunPort: mkPort({ perCapability: {} }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    await svc.start({ projectId: 'proj-1', mode: 'initial' }); // completed (no perCapability → empty)
    // Manually mark as awaiting_review to simulate an active scan
    db.prepare(`UPDATE bootstrap_scans SET status = 'awaiting_review' WHERE project_id = ?`).run(
      'proj-1',
    );
    await expect(svc.start({ projectId: 'proj-1', mode: 'rescan' })).rejects.toThrow(
      /already active/,
    );
  });

  it('marks scan failed when AiExploreService surfaces an error', async () => {
    const explore = new AiExploreService({
      aiRunPort: {
        startVirtualRun: async () => {
          throw new Error('boom');
        },
      },
      timeoutMs: 500,
    });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    // The aiRunPort rejects; AiExploreService captures the port error and propagates
    // it through `parseErrors`. Bootstrap converts empty-perCapability+parseErrors into
    // an explicit failure so the user sees a diagnostic instead of silent "0 applied".
    await expect(svc.start({ projectId: 'proj-1', mode: 'initial' })).rejects.toThrow(/boom/);
    const stored = db
      .prepare(`SELECT status, error_message FROM bootstrap_scans WHERE project_id = ?`)
      .get('proj-1') as { status: string; error_message: string };
    expect(stored.status).toBe('failed');
    expect(stored.error_message).toMatch(/boom/);
  });

  it('cancelScan transitions a running scan to cancelled and stamps finishedAt', async () => {
    const explore = new AiExploreService({ aiRunPort: mkPort({ perCapability: {} }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    // Start a scan and manually rewind it to 'running' to simulate an
    // interrupted bootstrap that never finished.
    const completed = await svc.start({ projectId: 'proj-1', mode: 'initial' });
    db.prepare(
      `UPDATE bootstrap_scans SET status='running', finished_at=NULL WHERE id = ?`,
    ).run(completed.scan.id);

    const cancelled = svc.cancelScan(completed.scan.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.finishedAt).toBeGreaterThan(0);
  });

  it('cancelScan is idempotent on a terminal scan', async () => {
    const explore = new AiExploreService({ aiRunPort: mkPort({ perCapability: {} }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    const completed = await svc.start({ projectId: 'proj-1', mode: 'initial' });
    expect(completed.scan.status).toBe('completed');
    const finishedAtBefore = completed.scan.finishedAt;

    const result = svc.cancelScan(completed.scan.id);
    expect(result.status).toBe('completed'); // unchanged
    expect(result.finishedAt).toBe(finishedAtBefore);
  });

  it('empty perCapability → scan completed with 0 applied, no corpus meta bump', async () => {
    const explore = new AiExploreService({ aiRunPort: mkPort({ perCapability: {} }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    const result = await svc.start({ projectId: 'proj-1', mode: 'initial' });
    expect(result.scan.appliedCount).toBe(0);
    expect(result.scan.status).toBe('completed');
    const meta = db
      .prepare(`SELECT * FROM project_spec_corpus_meta WHERE project_id = ?`)
      .get('proj-1');
    expect(meta).toBeUndefined();
  });
});
