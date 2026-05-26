// server/src/domains/openspec/__tests__/bootstrap-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as path from 'node:path';
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

  it('rescan auto-applies all ADDED and marks scan completed', async () => {
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

    const result = await svc.start({ projectId: 'proj-1', mode: 'rescan' });
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
    await svc.start({ projectId: 'proj-1', mode: 'rescan' }); // completed (no perCapability → empty)
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
    await expect(svc.start({ projectId: 'proj-1', mode: 'rescan' })).rejects.toThrow(/boom/);
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
    const completed = await svc.start({ projectId: 'proj-1', mode: 'rescan' });
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
    const completed = await svc.start({ projectId: 'proj-1', mode: 'rescan' });
    expect(completed.scan.status).toBe('completed');
    const finishedAtBefore = completed.scan.finishedAt;

    const result = svc.cancelScan(completed.scan.id);
    expect(result.status).toBe('completed'); // unchanged
    expect(result.finishedAt).toBe(finishedAtBefore);
  });

  it('empty perCapability → scan completed with 0 applied, no corpus meta bump', async () => {
    const explore = new AiExploreService({ aiRunPort: mkPort({ perCapability: {} }) });
    const svc = new BootstrapService({ db, explore, getProjectRoot: () => projectRoot });
    const result = await svc.start({ projectId: 'proj-1', mode: 'rescan' });
    expect(result.scan.appliedCount).toBe(0);
    expect(result.scan.status).toBe('completed');
    const meta = db
      .prepare(`SELECT * FROM project_spec_corpus_meta WHERE project_id = ?`)
      .get('proj-1');
    expect(meta).toBeUndefined();
  });

  describe('init mode: start', () => {
    it('starts Phase 1 in background and returns scan immediately with init_phase=discovering', async () => {
      let resolveAi: (() => void) | null = null;
      const aiStarted = new Promise<void>((resolve) => { resolveAi = resolve; });
      const port = {
        async startVirtualRun(args: any) {
          resolveAi!();
          await new Promise<void>((r) => setTimeout(r, 50));
          args.onMessage?.({
            kind: 'assistant',
            content: JSON.stringify({
              capabilities: [{ name: 'auth', description: 'login' }],
              uncertainties: [],
            }),
          });
          args.onMessage?.({ kind: 'run_completed' });
        },
      };
      const explore = new AiExploreService({ aiRunPort: port, timeoutMs: 5000 });
      const broadcastCalls: any[] = [];
      const svc = new BootstrapService({
        db, explore, getProjectRoot: () => projectRoot,
        broadcast: (scanId, payload) => broadcastCalls.push({ scanId, payload }),
      });
      const result = await svc.start({ projectId: 'proj-1', mode: 'initial' });
      expect(result.scan.status).toBe('running');
      expect(result.scan.initPhase).toBe('discovering');
      await aiStarted;
      await new Promise((r) => setTimeout(r, 150));
      const refreshed = db.prepare(`SELECT * FROM bootstrap_scans WHERE id = ?`).get(result.scan.id) as any;
      expect(refreshed.init_phase).toBe('picking');
      const candidates = db.prepare(`SELECT * FROM bootstrap_candidates WHERE scan_id = ?`).all(result.scan.id);
      expect(candidates).toHaveLength(1);
    });
  });

  describe('candidate edit ops', () => {
    async function setupAwaitingPicker(svc: BootstrapService) {
      // Manually create a scan in 'picking' phase
      const scanId = 'scan-pick';
      db.prepare(
        `INSERT INTO bootstrap_scans (id, project_id, status, started_at, applied_count, pending_count, init_phase)
         VALUES (?, 'proj-1', 'awaiting_review', ?, 0, 0, 'picking')`
      ).run(scanId, Date.now());
      return scanId;
    }

    it('addCandidate creates a user_added candidate', async () => {
      const svc = makeSvc();
      const scanId = await setupAwaitingPicker(svc);
      const c = svc.addCandidate(scanId, { name: 'manual-cap', description: 'I added this' });
      expect(c.source).toBe('user_added');
      expect(c.phase).toBe('discovered');
    });

    it('addCandidate rejects duplicate name', async () => {
      const svc = makeSvc();
      const scanId = await setupAwaitingPicker(svc);
      svc.addCandidate(scanId, { name: 'manual-cap', description: 'x' });
      expect(() => svc.addCandidate(scanId, { name: 'manual-cap', description: 'y' }))
        .toThrow(/already exists/);
    });

    it('addCandidate rejects invalid kebab-case name', async () => {
      const svc = makeSvc();
      const scanId = await setupAwaitingPicker(svc);
      expect(() => svc.addCandidate(scanId, { name: 'BadName', description: 'x' }))
        .toThrow(/kebab/);
    });

    it('patchCandidate updates title and description', async () => {
      const svc = makeSvc();
      const scanId = await setupAwaitingPicker(svc);
      const c = svc.addCandidate(scanId, { name: 'a', description: 'old' });
      const patched = svc.patchCandidate(c.id, { description: 'new' });
      expect(patched.description).toBe('new');
    });

    it('removeCandidate soft-deletes by setting phase=excluded', async () => {
      const svc = makeSvc();
      const scanId = await setupAwaitingPicker(svc);
      const c = svc.addCandidate(scanId, { name: 'a', description: 'x' });
      svc.removeCandidate(c.id);
      const refreshed = db.prepare(`SELECT phase FROM bootstrap_candidates WHERE id = ?`).get(c.id) as any;
      expect(refreshed.phase).toBe('excluded');
    });
  });

  describe('commitGeneration (Phase 2)', () => {
    const validMd =
      '## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n';

    it('runs Phase 2 sequentially for selected candidates, transitions to reviewing', async () => {
      let calls = 0;
      const port = {
        async startVirtualRun(args: any) {
          calls += 1;
          args.onMessage?.({ kind: 'assistant', content: `<spec>${validMd}</spec>` });
          args.onMessage?.({ kind: 'run_completed' });
        },
      };
      const explore = new AiExploreService({ aiRunPort: port, timeoutMs: 5000 });
      const broadcasts: any[] = [];
      const svc = new BootstrapService({
        db, explore, getProjectRoot: () => projectRoot, broadcast: (id, p) => broadcasts.push({ id, p }),
      });
      const scanId = 'scan-gen';
      db.prepare(`INSERT INTO bootstrap_scans (id, project_id, status, started_at, applied_count, pending_count, init_phase)
                  VALUES (?, 'proj-1', 'awaiting_review', ?, 0, 0, 'picking')`).run(scanId, Date.now());
      const c1 = svc.addCandidate(scanId, { name: 'auth', description: 'login' });
      const c2 = svc.addCandidate(scanId, { name: 'billing', description: 'subs' });

      await svc.commitGeneration(scanId);
      await new Promise((r) => setTimeout(r, 200));

      expect(calls).toBe(2);
      const r1 = db.prepare(`SELECT phase, generated_md FROM bootstrap_candidates WHERE id = ?`).get(c1.id) as any;
      const r2 = db.prepare(`SELECT phase, generated_md FROM bootstrap_candidates WHERE id = ?`).get(c2.id) as any;
      expect(r1.phase).toBe('generated');
      expect(r2.phase).toBe('generated');
      expect(r1.generated_md).toBe(validMd);
      const scan = db.prepare(`SELECT init_phase FROM bootstrap_scans WHERE id = ?`).get(scanId) as any;
      expect(scan.init_phase).toBe('reviewing');
    });
  });

  describe('approve / reject / retry', () => {
    const validMd =
      '## Purpose\n\nFoo.\n\n## Requirements\n\n### Requirement: Foo\n\nThe system MUST do foo.\n\n#### Scenario: bar\n\n- **WHEN** x\n- **THEN** y\n';

    function seedGenerated(svc: BootstrapService) {
      const scanId = 'scan-rev';
      db.prepare(`INSERT INTO bootstrap_scans (id, project_id, status, started_at, applied_count, pending_count, init_phase)
                  VALUES (?, 'proj-1', 'awaiting_review', ?, 0, 0, 'reviewing')`).run(scanId, Date.now());
      const c = svc.addCandidate(scanId, { name: 'auth', description: 'login' });
      db.prepare(`UPDATE bootstrap_candidates SET phase='generated', generated_md=? WHERE id=?`).run(validMd, c.id);
      return { scanId, candidateId: c.id };
    }

    it('approve writes spec.md to disk', async () => {
      const svc = makeSvc();
      const { candidateId } = seedGenerated(svc);
      svc.approveCandidate(candidateId);
      const filePath = path.join(projectRoot, 'openspec', 'specs', 'auth', 'spec.md');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(validMd);
    });

    it('approve creates openspec/config.yaml on first write only', async () => {
      const svc = makeSvc();
      const { candidateId } = seedGenerated(svc);
      svc.approveCandidate(candidateId);
      const cfg = path.join(projectRoot, 'openspec', 'config.yaml');
      expect(fs.existsSync(cfg)).toBe(true);
      expect(fs.readFileSync(cfg, 'utf-8').trim()).toBe('schema: spec-driven');
      // Modify config, approve another — should not be overwritten
      fs.writeFileSync(cfg, 'schema: spec-driven\ncontext: |\n  custom user content\n');
      const c2 = svc.addCandidate('scan-rev', { name: 'billing', description: 'subs' });
      db.prepare(`UPDATE bootstrap_candidates SET phase='generated', generated_md=? WHERE id=?`).run(validMd, c2.id);
      svc.approveCandidate(c2.id);
      expect(fs.readFileSync(cfg, 'utf-8')).toContain('custom user content');
    });

    it('reject marks candidate rejected, does not write to disk', async () => {
      const svc = makeSvc();
      const { candidateId } = seedGenerated(svc);
      svc.rejectCandidate(candidateId);
      const after = db.prepare(`SELECT phase FROM bootstrap_candidates WHERE id=?`).get(candidateId) as any;
      expect(after.phase).toBe('rejected');
    });

    it('retry resets candidate to discovered and reruns Phase 2 for just that cap', async () => {
      let calls = 0;
      const port = {
        async startVirtualRun(args: any) {
          calls += 1;
          args.onMessage?.({ kind: 'assistant', content: `<spec>${validMd}</spec>` });
          args.onMessage?.({ kind: 'run_completed' });
        },
      };
      const explore = new AiExploreService({ aiRunPort: port, timeoutMs: 5000 });
      const svc = new BootstrapService({
        db, explore, getProjectRoot: () => projectRoot, broadcast: () => {},
      });
      const scanId = 'scan-retry';
      db.prepare(`INSERT INTO bootstrap_scans (id, project_id, status, started_at, applied_count, pending_count, init_phase)
                  VALUES (?, 'proj-1', 'awaiting_review', ?, 0, 0, 'reviewing')`).run(scanId, Date.now());
      const c = svc.addCandidate(scanId, { name: 'auth', description: 'login' });
      db.prepare(`UPDATE bootstrap_candidates SET phase='failed', error_message='boom' WHERE id=?`).run(c.id);

      await svc.retryCandidate(c.id);
      await new Promise((r) => setTimeout(r, 150));

      expect(calls).toBe(1);
      const after = db.prepare(`SELECT phase, generated_md FROM bootstrap_candidates WHERE id=?`).get(c.id) as any;
      expect(after.phase).toBe('generated');
      expect(after.generated_md).toBe(validMd);
    });
  });

  // Helper to make svc within `describe`:
  function makeSvc(): BootstrapService {
    const explore = new AiExploreService({ aiRunPort: mkPort({ perCapability: {} }) });
    return new BootstrapService({
      db, explore, getProjectRoot: () => projectRoot, broadcast: () => {},
    });
  }
});
