// server/src/domains/openspec/__tests__/spec-change-drafting-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import {
  SpecChangeDraftingService,
  buildProposalPrompt,
  buildDeltaPrompt,
} from '../spec-change-drafting-service.js';

function mkPort(reply: string) {
  return {
    async startVirtualRun(args: {
      onMessage?: (m: { kind: string; content?: string }) => void;
    }): Promise<void> {
      args.onMessage?.({ kind: 'assistant', content: reply });
      args.onMessage?.({ kind: 'run_completed' });
    },
  };
}

describe('SpecChangeDraftingService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let specChangeId: string;

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
    ).run(
      'i',
      'proj-1',
      'Add 2FA support',
      'Users need 2FA for login',
      'open',
      'medium',
      '[]',
      0,
      0,
      'implement',
      0,
    );
    db.prepare(
      `INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'sc',
      'proj-1',
      'i',
      'add-2fa',
      'Add 2FA support',
      'drafting',
      'openspec/changes/add-2fa/proposal.md',
      'openspec/changes/add-2fa/design.md',
      'openspec/changes/add-2fa/tasks.md',
      0,
      0,
    );
    specChangeId = 'sc';
    projectRoot = mkdtempSync(join(tmpdir(), 'draft-'));
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  it('draftProposal includes issue title + description in the prompt', async () => {
    let capturedPrompt = '';
    const port = {
      async startVirtualRun(args: {
        input: string;
        onMessage?: (m: { kind: string; content?: string }) => void;
      }): Promise<void> {
        capturedPrompt = args.input;
        args.onMessage?.({
          kind: 'assistant',
          content: '# Proposal: Add 2FA support\n\n## Why\nUsers need this.\n',
        });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new SpecChangeDraftingService({
      db,
      aiRunPort: port,
      getProjectRoot: () => projectRoot,
    });
    const result = await svc.draftProposal(specChangeId);
    expect(capturedPrompt).toContain('Add 2FA support');
    expect(capturedPrompt).toContain('Users need 2FA for login');
    expect(result.content).toContain('# Proposal');
  });

  it('draftDesign reads proposal.md from disk and embeds it in prompt', async () => {
    const changeDir = join(projectRoot, 'openspec', 'changes', 'add-2fa');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'proposal.md'), '# Proposal\n\n## Why\nUser security.\n');

    let capturedPrompt = '';
    const port = {
      async startVirtualRun(args: {
        input: string;
        onMessage?: (m: { kind: string; content?: string }) => void;
      }): Promise<void> {
        capturedPrompt = args.input;
        args.onMessage?.({ kind: 'assistant', content: '# Design\n' });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new SpecChangeDraftingService({
      db,
      aiRunPort: port,
      getProjectRoot: () => projectRoot,
    });
    await svc.draftDesign(specChangeId);
    expect(capturedPrompt).toContain('User security');
  });

  it('draftDelta summarizes existing corpus capability when present', async () => {
    const corpusDir = join(projectRoot, 'openspec', 'specs', 'auth');
    mkdirSync(corpusDir, { recursive: true });
    writeFileSync(
      join(corpusDir, 'spec.md'),
      `# auth Specification\n\n## Requirements\n\n### Requirement: Login\n\nMUST authenticate.\n\n#### Scenario: Valid\n- **WHEN** valid\n- **THEN** SHALL return token\n`,
    );
    let capturedPrompt = '';
    const port = {
      async startVirtualRun(args: {
        input: string;
        onMessage?: (m: { kind: string; content?: string }) => void;
      }): Promise<void> {
        capturedPrompt = args.input;
        args.onMessage?.({ kind: 'assistant', content: '## ADDED Requirements\n' });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new SpecChangeDraftingService({
      db,
      aiRunPort: port,
      getProjectRoot: () => projectRoot,
    });
    await svc.draftDelta(specChangeId, 'auth');
    expect(capturedPrompt).toContain('Existing requirements (1)');
    expect(capturedPrompt).toContain('- Login');
  });

  it('draftDelta tolerates missing corpus capability (new capability)', async () => {
    let capturedPrompt = '';
    const port = {
      async startVirtualRun(args: {
        input: string;
        onMessage?: (m: { kind: string; content?: string }) => void;
      }): Promise<void> {
        capturedPrompt = args.input;
        args.onMessage?.({ kind: 'assistant', content: '## ADDED Requirements\n' });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new SpecChangeDraftingService({
      db,
      aiRunPort: port,
      getProjectRoot: () => projectRoot,
    });
    const result = await svc.draftDelta(specChangeId, 'new-cap');
    expect(capturedPrompt).toContain('capability does not yet exist in corpus');
    expect(result.content).toContain('ADDED');
  });

  it('strips outer code-fence wrapper if AI returns ```markdown ... ```', async () => {
    const port = mkPort('```markdown\n# wrapped\n\ncontent\n```\n');
    const svc = new SpecChangeDraftingService({
      db,
      aiRunPort: port,
      getProjectRoot: () => projectRoot,
    });
    const result = await svc.draftProposal(specChangeId);
    expect(result.content).toBe('# wrapped\n\ncontent\n');
  });

  it('throws when spec_change is unknown', async () => {
    const port = mkPort('');
    const svc = new SpecChangeDraftingService({
      db,
      aiRunPort: port,
      getProjectRoot: () => projectRoot,
    });
    await expect(svc.draftProposal('nope')).rejects.toThrow(/SpecChange not found/);
  });

  it('throws when sub-issue is missing (data integrity)', async () => {
    db.prepare(`DELETE FROM local_issues WHERE id = 'i'`).run();
    db.pragma('foreign_keys = OFF');
    // FK spec_changes.sub_issue_id is ON DELETE CASCADE so it would have deleted sc too.
    // Reinsert spec_change without FK enforcement to exercise the service-level guard.
    db.prepare(
      `INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('orphan', 'proj-1', 'ghost', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);
    const port = mkPort('');
    const svc = new SpecChangeDraftingService({
      db,
      aiRunPort: port,
      getProjectRoot: () => projectRoot,
    });
    await expect(svc.draftProposal('orphan')).rejects.toThrow(/Sub-issue not found/);
  });

  it('buildProposalPrompt sanity', () => {
    const p = buildProposalPrompt({
      issueTitle: 'X',
      issueDescription: 'Y',
      issueType: 'bug',
      slug: 'x',
    });
    expect(p).toMatch(/Title: X/);
    expect(p).toMatch(/Description: Y/);
    expect(p).toMatch(/bug/);
  });

  it('buildDeltaPrompt names the capability and includes corpus summary', () => {
    const p = buildDeltaPrompt({
      issueTitle: 'X',
      issueType: 'implement',
      slug: 'x',
      proposal: 'p',
      design: 'd',
      capability: 'billing',
      corpusSummary: 'Existing requirements (3):\n- a\n- b\n- c',
    });
    expect(p).toContain('billing');
    expect(p).toContain('Existing requirements (3)');
  });
});
