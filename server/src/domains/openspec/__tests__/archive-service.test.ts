// server/src/domains/openspec/__tests__/archive-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import { ArchiveService } from '../archive-service.js';
import { SpecChangeService } from '../spec-change-service.js';

const SAMPLE_DELTA = `## Purpose
Adds 2FA.

## ADDED Requirements
### Requirement: 2FA enrollment

System SHALL allow 2FA enrollment.

#### Scenario: User enrolls
- **WHEN** user opts in
- **THEN** system SHALL provision TOTP
`;

const SAMPLE_CORPUS = `# auth Specification

## Purpose
Handles user auth.

## Requirements

### Requirement: Login

System SHALL authenticate users.

#### Scenario: Valid
- **WHEN** valid
- **THEN** SHALL return token
`;

describe('ArchiveService', () => {
  let db: Database.Database;
  let projectRoot: string;
  let scService: SpecChangeService;
  let archive: ArchiveService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('proj-1', 'P', 'code', 0, 0);
    db.prepare(`INSERT INTO local_issues (id, project_id, title, description, status, priority, labels, created_at, updated_at, type, is_anonymous)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    projectRoot = mkdtempSync(path.join(tmpdir(), 'openspec-arch-'));
    scService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    archive = new ArchiveService({ db, getProjectRoot: () => projectRoot });
  });

  afterEach(() => {
    db.close();
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* */ }
  });

  it('merges ADDED requirement into an existing corpus and moves change to archive/', async () => {
    // Seed corpus
    const corpusDir = path.join(projectRoot, 'openspec', 'specs', 'auth');
    fs.mkdirSync(corpusDir, { recursive: true });
    fs.writeFileSync(path.join(corpusDir, 'spec.md'), SAMPLE_CORPUS);

    // Create change + delta
    const sc = scService.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'add-2fa', title: 'Add 2FA' });
    scService.writeDeltaSpec(sc.id, 'auth', SAMPLE_DELTA);

    const result = await archive.archive(sc.id);
    expect(result.ok).toBe(true);
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0].added).toEqual(['2FA enrollment']);
    // Change folder moved
    expect(fs.existsSync(path.join(projectRoot, 'openspec', 'changes', 'add-2fa'))).toBe(false);
    expect(fs.existsSync(result.archivedDir!)).toBe(true);
    // Corpus updated
    const newCorpus = fs.readFileSync(path.join(corpusDir, 'spec.md'), 'utf-8');
    expect(newCorpus).toContain('### Requirement: Login');
    expect(newCorpus).toContain('### Requirement: 2FA enrollment');
    // spec_change row updated
    const updated = scService.getById(sc.id)!;
    expect(updated.status).toBe('archived');
    expect(updated.archivedAt).toBeTruthy();
  });

  it('creates a fresh corpus file when capability did not exist', async () => {
    const sc = scService.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'new-cap', title: 'X' });
    scService.writeDeltaSpec(sc.id, 'newcap', SAMPLE_DELTA);
    const result = await archive.archive(sc.id);
    expect(result.ok).toBe(true);
    const newCorpus = fs.readFileSync(path.join(projectRoot, 'openspec', 'specs', 'newcap', 'spec.md'), 'utf-8');
    expect(newCorpus).toContain('### Requirement: 2FA enrollment');
  });

  it('aborts archive on validation error and does NOT move folder', async () => {
    const sc = scService.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'bad', title: 'X' });
    // Invalid delta: ADDED requirement with no scenarios
    const invalid = `## ADDED Requirements
### Requirement: Bad
System MUST do.
`;
    scService.writeDeltaSpec(sc.id, 'cap', invalid);
    const result = await archive.archive(sc.id);
    expect(result.ok).toBe(false);
    expect(result.validationErrors).toHaveLength(1);
    expect(fs.existsSync(path.join(projectRoot, 'openspec', 'changes', 'bad'))).toBe(true);
  });

  it('handles delta with no spec files (empty change)', async () => {
    const sc = scService.createSpecChange({ projectId: 'proj-1', subIssueId: 'i', slug: 'empty', title: 'X' });
    const result = await archive.archive(sc.id);
    expect(result.ok).toBe(true);
    expect(result.capabilities).toEqual([]);
    expect(fs.existsSync(result.archivedDir!)).toBe(true);
  });

  it('throws on unknown spec_change id', async () => {
    await expect(archive.archive('nope')).rejects.toThrow(/SpecChange not found/);
  });
});
