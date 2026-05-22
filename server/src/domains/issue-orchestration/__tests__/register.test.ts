// server/src/domains/issue-orchestration/__tests__/register.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import {
  ExecutorRegistry,
  ExecutorInstanceRepository,
  ManualAdapter,
} from '../../executor/index.js';
import { SpecChangeService, ArchiveService } from '../../openspec/index.js';
import { registerIssueOrchestration } from '../register.js';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';

describe('registerIssueOrchestration broadcast wiring', () => {
  let db: Database.Database;
  let projectRoot: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    db.prepare(
      `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('proj-1', 'P', 'code', 0, 0);
    projectRoot = mkdtempSync(join(tmpdir(), 'wsbcast-'));
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  });

  function buildDeps() {
    const registry = new ExecutorRegistry();
    registry.register('manual', (instance) => new ManualAdapter(db, instance));
    const specChangeService = new SpecChangeService({ db, getProjectRoot: () => projectRoot });
    const archiveService = new ArchiveService({ db, getProjectRoot: () => projectRoot });
    return { registry, specChangeService, archiveService };
  }

  it('broadcasts executor.status_changed as openspec_executor_status_changed', async () => {
    const { registry, specChangeService, archiveService } = buildDeps();
    const broadcast = vi.fn();
    const io = registerIssueOrchestration({
      db,
      registry,
      specChangeService,
      archiveService,
      broadcast,
    });

    // Setup: sub-issue + spec_change + executor; advance the sub-issue to
    // tasks_ready so the propagator allows executor.start without complaint.
    const { issue, specChange } = io.lifecycle.createSubIssue({
      projectId: 'proj-1',
      type: 'implement',
      title: 'A',
    });
    io.lifecycle.transitionStatus(issue.id, 'planning');
    io.lifecycle.transitionStatus(issue.id, 'tasks_ready');
    const repo = new ExecutorInstanceRepository(db);
    const inst = repo.create({
      projectId: 'proj-1',
      specChangeId: specChange.id,
      type: 'manual',
    });

    broadcast.mockClear();
    await io.executorService.start(inst.id);

    const calls = broadcast.mock.calls as [string, ServerMessage][];
    const execEvents = calls.filter(([, m]) => m.type === 'openspec_executor_status_changed');
    expect(execEvents.length).toBeGreaterThan(0);
    expect(execEvents[0][0]).toBe('proj-1');
    const msg = execEvents[0][1];
    if (msg.type === 'openspec_executor_status_changed') {
      expect(msg.projectId).toBe('proj-1');
      expect(msg.executorInstanceId).toBe(inst.id);
      expect(msg.specChangeId).toBe(specChange.id);
      expect(msg.prev).toBe('pending');
      expect(msg.next).toBe('executing');
    }

    io.dispose();
  });

  it('broadcasts sub_issue.status_changed as openspec_sub_issue_status_changed', () => {
    const { registry, specChangeService, archiveService } = buildDeps();
    const broadcast = vi.fn();
    const io = registerIssueOrchestration({
      db,
      registry,
      specChangeService,
      archiveService,
      broadcast,
    });

    const { issue } = io.lifecycle.createSubIssue({
      projectId: 'proj-1',
      type: 'implement',
      title: 'A',
    });
    broadcast.mockClear();
    io.lifecycle.transitionStatus(issue.id, 'planning');

    const calls = broadcast.mock.calls as [string, ServerMessage][];
    const subEvents = calls.filter(([, m]) => m.type === 'openspec_sub_issue_status_changed');
    expect(subEvents.length).toBeGreaterThan(0);
    expect(subEvents[0][0]).toBe('proj-1');
    const msg = subEvents[0][1];
    if (msg.type === 'openspec_sub_issue_status_changed') {
      expect(msg.projectId).toBe('proj-1');
      expect(msg.subIssueId).toBe(issue.id);
      expect(msg.prev).toBe('open');
      expect(msg.next).toBe('planning');
    }

    io.dispose();
  });

  it('dispose() unhooks the broadcast subscription', () => {
    const { registry, specChangeService, archiveService } = buildDeps();
    const broadcast = vi.fn();
    const io = registerIssueOrchestration({
      db,
      registry,
      specChangeService,
      archiveService,
      broadcast,
    });

    const { issue } = io.lifecycle.createSubIssue({
      projectId: 'proj-1',
      type: 'implement',
      title: 'A',
    });
    io.dispose();
    broadcast.mockClear();
    io.lifecycle.transitionStatus(issue.id, 'planning');

    const subEvents = broadcast.mock.calls.filter(
      ([, m]) => (m as ServerMessage).type === 'openspec_sub_issue_status_changed',
    );
    expect(subEvents.length).toBe(0);
  });

  it('no-op when broadcast not provided (regression)', () => {
    const { registry, specChangeService, archiveService } = buildDeps();
    const io = registerIssueOrchestration({
      db,
      registry,
      specChangeService,
      archiveService,
    });

    const { issue } = io.lifecycle.createSubIssue({
      projectId: 'proj-1',
      type: 'implement',
      title: 'A',
    });
    expect(() => io.lifecycle.transitionStatus(issue.id, 'planning')).not.toThrow();
    io.dispose();
  });
});
