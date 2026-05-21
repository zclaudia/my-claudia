// server/src/domains/issue-orchestration/__tests__/anonymous-issue-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { SpecChangeService } from '../../openspec/spec-change-service.js';
import { ArchiveService } from '../../openspec/archive-service.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { IssueLifecycle } from '../issue-lifecycle.js';
import { AnonymousIssueService } from '../anonymous-issue-service.js';
import type { IssueDomainEvent } from '../events.js';

const SAMPLE_DELTA = `## ADDED Requirements
### Requirement: Anon test
System MUST do.

#### Scenario: x
- **WHEN** x
- **THEN** y
`;

describe('AnonymousIssueService + close→archive integration', () => {
  let db: Database.Database;
  let projectRoot: string;
  let lifecycle: IssueLifecycle;
  let scService: SpecChangeService;
  let archive: ArchiveService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'anon-'));
    scService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    archive = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    lifecycle = new IssueLifecycle({
      db,
      specChangeService: scService,
      dispatcher,
      archiveService: archive,
    });
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('createAnonymous creates a sub-issue with isAnonymous=true and no parent', () => {
    const anon = new AnonymousIssueService(lifecycle);
    const { issue, specChange } = anon.createAnonymous({
      projectId: 'proj-1',
      title: 'Rename foo to bar',
    });
    expect(issue.type).toBe('implement');
    expect(issue.isAnonymous).toBe(true);
    expect(issue.parentIssueId).toBeUndefined();
    expect(specChange.slug).toBe('rename-foo-to-bar');
  });

  it('closeSubIssueAndArchive moves the change folder and merges delta', async () => {
    const anon = new AnonymousIssueService(lifecycle);
    const { issue, specChange } = anon.createAnonymous({
      projectId: 'proj-1',
      title: 'Quick fix',
    });
    scService.writeDeltaSpec(specChange.id, 'core', SAMPLE_DELTA);
    lifecycle.transitionStatus(issue.id, 'planning');
    lifecycle.transitionStatus(issue.id, 'tasks_ready');
    lifecycle.transitionStatus(issue.id, 'executing');
    lifecycle.transitionStatus(issue.id, 'reviewing');

    const result = await lifecycle.closeSubIssueAndArchive(issue.id);
    expect(result.issue.status).toBe('closed');
    expect(result.archive?.ok).toBe(true);
    expect(result.archive?.archivedDir).toBeDefined();
    expect(fs.existsSync(result.archive!.archivedDir!)).toBe(true);
    // Corpus written
    const corpus = fs.readFileSync(
      join(projectRoot, 'openspec', 'specs', 'core', 'spec.md'),
      'utf-8',
    );
    expect(corpus).toContain('Anon test');
  });

  it('closeSubIssueAndArchive without archiveService returns issue only', async () => {
    const dispatcher = new EventDispatcher<IssueDomainEvent>();
    const lc2 = new IssueLifecycle({ db, specChangeService: scService, dispatcher }); // no archiveService
    const { issue } = lc2.createSubIssue({
      projectId: 'proj-1',
      type: 'implement',
      title: 'A',
    });
    lc2.transitionStatus(issue.id, 'planning');
    lc2.transitionStatus(issue.id, 'tasks_ready');
    lc2.transitionStatus(issue.id, 'executing');
    lc2.transitionStatus(issue.id, 'reviewing');
    const result = await lc2.closeSubIssueAndArchive(issue.id);
    expect(result.issue.status).toBe('closed');
    expect(result.archive).toBeUndefined();
  });
});
