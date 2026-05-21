import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infrastructure/storage/migrations/index.js';
import {
  ExecutorInstanceRepository,
  ExecutorRegistry,
  ManualAdapter,
} from '../../executor/index.js';
import { EventDispatcher } from '../../supervision/event-dispatcher.js';
import { ExecutorService } from '../executor-service.js';
import type { IssueDomainEvent } from '../events.js';

describe('ExecutorService', () => {
  let db: Database.Database;
  let dispatcher: EventDispatcher<IssueDomainEvent>;
  let service: ExecutorService;
  let executorInstanceId: string;

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
    ).run('i', 'proj-1', 't', null, 'open', 'medium', '[]', 0, 0, 'implement', 0);
    db.prepare(
      `INSERT INTO spec_changes (id, project_id, sub_issue_id, slug, title, status, proposal_path, design_path, tasks_path, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sc', 'proj-1', 'i', 'x', 'X', 'drafting', 'a', 'b', 'c', 0, 0);

    const registry = new ExecutorRegistry();
    registry.register('manual', (instance) => new ManualAdapter(db, instance));

    const repo = new ExecutorInstanceRepository(db);
    const inst = repo.create({ projectId: 'proj-1', specChangeId: 'sc', type: 'manual' });
    executorInstanceId = inst.id;

    dispatcher = new EventDispatcher<IssueDomainEvent>();
    service = new ExecutorService({ db, registry, dispatcher });
  });

  it('start() advances pending -> executing and dispatches an event', async () => {
    const events: IssueDomainEvent[] = [];
    dispatcher.on('executor.status_changed', (e) => events.push(e));
    await service.start(executorInstanceId);
    expect(service.getStatus(executorInstanceId)).toBe('executing');
    expect(events).toHaveLength(1);
    if (events[0].type === 'executor.status_changed') {
      expect(events[0].prev).toBe('pending');
      expect(events[0].next).toBe('executing');
    }
  });

  it('does NOT dispatch when status unchanged (refresh on stable state)', async () => {
    await service.start(executorInstanceId);
    const events: IssueDomainEvent[] = [];
    dispatcher.on('executor.status_changed', (e) => events.push(e));
    await service.refresh(executorInstanceId);
    expect(events).toHaveLength(0);
  });

  it('cancel() dispatches executing -> cancelled', async () => {
    await service.start(executorInstanceId);
    const events: IssueDomainEvent[] = [];
    dispatcher.on('executor.status_changed', (e) => events.push(e));
    await service.cancel(executorInstanceId);
    expect(events).toHaveLength(1);
    if (events[0].type === 'executor.status_changed') {
      expect(events[0].prev).toBe('executing');
      expect(events[0].next).toBe('cancelled');
    }
  });

  it('markCompleted() dispatches executing -> completed for ManualAdapter', async () => {
    await service.start(executorInstanceId);
    const events: IssueDomainEvent[] = [];
    dispatcher.on('executor.status_changed', (e) => events.push(e));
    await service.markCompleted(executorInstanceId);
    expect(service.getStatus(executorInstanceId)).toBe('completed');
    expect(events).toHaveLength(1);
  });

  it('throws on unknown instance id', async () => {
    await expect(service.start('nope')).rejects.toThrow(/ExecutorInstance not found/);
  });

  it('markCompleted on non-Manual adapter throws', async () => {
    // Register a fake non-manual adapter that does not expose markCompleted.
    const fakeAdapter = {
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      getStatus: () => 'executing' as const,
      getProgress: () => ({ fraction: -1, summary: '' }),
      getOutputCommits: () => [],
    };
    const registry2 = new ExecutorRegistry();
    registry2.register('classic', () => fakeAdapter);
    const repo = new ExecutorInstanceRepository(db);
    const inst = repo.create({
      projectId: 'proj-1',
      specChangeId: 'sc',
      type: 'classic',
      underlyingId: 'x',
    });
    const svc2 = new ExecutorService({ db, registry: registry2, dispatcher });
    await expect(svc2.markCompleted(inst.id)).rejects.toThrow(/markCompleted/);
  });
});
