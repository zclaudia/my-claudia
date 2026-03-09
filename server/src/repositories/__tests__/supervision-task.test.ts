import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SupervisionTaskRepository } from '../supervision-task.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'code',
      provider_id TEXT,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      agent TEXT,
      context_sync_status TEXT DEFAULT 'synced',
      is_internal INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      provider_id TEXT,
      sdk_session_id TEXT,
      type TEXT DEFAULT 'regular',
      parent_session_id TEXT,
      working_directory TEXT,
      project_role TEXT,
      task_id TEXT,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE supervision_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent_discovered')),
      session_id TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      dependencies TEXT,
      dependency_mode TEXT DEFAULT 'all',
      relevant_doc_ids TEXT,
      task_specific_context TEXT,
      scope TEXT,
      acceptance_criteria TEXT,
      max_retries INTEGER DEFAULT 2,
      attempt INTEGER NOT NULL DEFAULT 1,
      base_commit TEXT,
      result TEXT,
      schedule_cron TEXT,
      schedule_next_run INTEGER,
      schedule_enabled INTEGER DEFAULT 0,
      retry_delay_ms INTEGER DEFAULT 5000,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );

    CREATE INDEX idx_supervision_tasks_project ON supervision_tasks(project_id);
    CREATE INDEX idx_supervision_tasks_status ON supervision_tasks(status);
  `);

  return db;
}

function seedProject(db: Database.Database, id = 'proj-1'): string {
  const now = Date.now();
  db.prepare(
    `INSERT INTO projects (id, name, type, created_at, updated_at) VALUES (?, ?, 'code', ?, ?)`,
  ).run(id, 'Test Project', now, now);
  return id;
}

describe('SupervisionTaskRepository', () => {
  let db: Database.Database;
  let repo: SupervisionTaskRepository;
  let projectId: string;

  beforeAll(() => {
    db = createTestDb();
    repo = new SupervisionTaskRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM supervision_tasks');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    projectId = seedProject(db);
  });

  describe('create()', () => {
    it('creates a task with source=user and persists all fields correctly', () => {
      const task = repo.create({
        projectId,
        title: 'Implement login',
        description: 'Build the login page with OAuth',
        source: 'user',
        status: 'pending',
        priority: 5,
        dependencies: ['dep-1', 'dep-2'],
        dependencyMode: 'all',
        relevantDocIds: ['specs/auth.md'],
        taskSpecificContext: 'Use OAuth 2.0',
        scope: ['src/auth'],
        acceptanceCriteria: ['Login works', 'Tests pass'],
        maxRetries: 3,
      });

      expect(task.id).toBeDefined();
      expect(task.projectId).toBe(projectId);
      expect(task.title).toBe('Implement login');
      expect(task.description).toBe('Build the login page with OAuth');
      expect(task.source).toBe('user');
      expect(task.status).toBe('pending');
      expect(task.priority).toBe(5);
      expect(task.dependencies).toEqual(['dep-1', 'dep-2']);
      expect(task.dependencyMode).toBe('all');
      expect(task.relevantDocIds).toEqual(['specs/auth.md']);
      expect(task.taskSpecificContext).toBe('Use OAuth 2.0');
      expect(task.scope).toEqual(['src/auth']);
      expect(task.acceptanceCriteria).toEqual(['Login works', 'Tests pass']);
      expect(task.maxRetries).toBe(3);
      expect(task.attempt).toBe(1);
      expect(task.createdAt).toBeGreaterThan(0);
      expect(task.startedAt).toBeUndefined();
      expect(task.completedAt).toBeUndefined();
      expect(task.result).toBeUndefined();
      expect(task.baseCommit).toBeUndefined();
    });

    it('uses default values when optional fields are omitted', () => {
      const task = repo.create({
        projectId,
        title: 'Simple task',
        description: 'A basic task',
        source: 'user',
        status: 'pending',
      });

      expect(task.priority).toBe(0);
      expect(task.dependencies).toEqual([]);
      expect(task.dependencyMode).toBe('all');
      expect(task.relevantDocIds).toBeUndefined();
      expect(task.taskSpecificContext).toBeUndefined();
      expect(task.scope).toBeUndefined();
      expect(task.acceptanceCriteria).toEqual([]);
      expect(task.maxRetries).toBe(2);
      expect(task.attempt).toBe(1);
    });
  });

  describe('findById()', () => {
    it('returns the created task', () => {
      const created = repo.create({
        projectId,
        title: 'Find me',
        description: 'Find this task',
        source: 'user',
        status: 'pending',
      });

      const found = repo.findById(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.title).toBe('Find me');
    });

    it('returns undefined for non-existent id', () => {
      const found = repo.findById('non-existent-id');
      expect(found).toBeUndefined();
    });
  });

  describe('findByProjectId()', () => {
    it('returns tasks sorted by priority then created_at', () => {
      // Create tasks with different priorities
      repo.create({
        projectId,
        title: 'Low priority',
        description: 'desc',
        source: 'user',
        status: 'pending',
        priority: 10,
      });
      repo.create({
        projectId,
        title: 'High priority',
        description: 'desc',
        source: 'user',
        status: 'pending',
        priority: 1,
      });
      repo.create({
        projectId,
        title: 'Medium priority',
        description: 'desc',
        source: 'user',
        status: 'pending',
        priority: 5,
      });

      const tasks = repo.findByProjectId(projectId);
      expect(tasks).toHaveLength(3);
      expect(tasks[0].title).toBe('High priority');
      expect(tasks[1].title).toBe('Medium priority');
      expect(tasks[2].title).toBe('Low priority');
    });

    it('returns empty array for project with no tasks', () => {
      const tasks = repo.findByProjectId('no-tasks-project');
      expect(tasks).toEqual([]);
    });
  });

  describe('findByStatus()', () => {
    it('returns tasks matching multiple statuses', () => {
      repo.create({ projectId, title: 'Pending', description: 'd', source: 'user', status: 'pending' });
      repo.create({ projectId, title: 'Running', description: 'd', source: 'user', status: 'running' });
      repo.create({ projectId, title: 'Integrated', description: 'd', source: 'user', status: 'integrated' });
      repo.create({ projectId, title: 'Failed', description: 'd', source: 'user', status: 'failed' });

      const active = repo.findByStatus(projectId, 'pending', 'running');
      expect(active).toHaveLength(2);
      const titles = active.map((t) => t.title);
      expect(titles).toContain('Pending');
      expect(titles).toContain('Running');
    });

    it('returns empty array when no tasks match status', () => {
      repo.create({ projectId, title: 'Pending', description: 'd', source: 'user', status: 'pending' });
      const result = repo.findByStatus(projectId, 'running');
      expect(result).toEqual([]);
    });
  });

  describe('updateStatus()', () => {
    it('sets started_at automatically when status is running', () => {
      const task = repo.create({
        projectId,
        title: 'Start me',
        description: 'd',
        source: 'user',
        status: 'pending',
      });

      expect(task.startedAt).toBeUndefined();

      const before = Date.now();
      repo.updateStatus(task.id, 'running');
      const after = Date.now();

      const updated = repo.findById(task.id)!;
      expect(updated.status).toBe('running');
      expect(updated.startedAt).toBeGreaterThanOrEqual(before);
      expect(updated.startedAt).toBeLessThanOrEqual(after);
    });

    it('does not overwrite started_at if already set', () => {
      const task = repo.create({
        projectId,
        title: 'Already started',
        description: 'd',
        source: 'user',
        status: 'pending',
      });

      repo.updateStatus(task.id, 'running');
      const firstRun = repo.findById(task.id)!;
      const firstStartedAt = firstRun.startedAt;

      // Re-running after a re-queue should keep original started_at
      repo.updateStatus(task.id, 'queued');
      repo.updateStatus(task.id, 'running');
      const secondRun = repo.findById(task.id)!;
      expect(secondRun.startedAt).toBe(firstStartedAt);
    });

    it('sets completed_at when status is integrated', () => {
      const task = repo.create({
        projectId,
        title: 'Complete me',
        description: 'd',
        source: 'user',
        status: 'running',
      });

      const before = Date.now();
      repo.updateStatus(task.id, 'integrated');
      const after = Date.now();

      const updated = repo.findById(task.id)!;
      expect(updated.status).toBe('integrated');
      expect(updated.completedAt).toBeGreaterThanOrEqual(before);
      expect(updated.completedAt).toBeLessThanOrEqual(after);
    });

    it('sets completed_at when status is failed', () => {
      const task = repo.create({
        projectId,
        title: 'Fail me',
        description: 'd',
        source: 'user',
        status: 'running',
      });

      repo.updateStatus(task.id, 'failed');
      const updated = repo.findById(task.id)!;
      expect(updated.status).toBe('failed');
      expect(updated.completedAt).toBeDefined();
    });

    it('sets completed_at when status is cancelled', () => {
      const task = repo.create({
        projectId,
        title: 'Cancel me',
        description: 'd',
        source: 'user',
        status: 'proposed',
      });

      repo.updateStatus(task.id, 'cancelled');
      const updated = repo.findById(task.id)!;
      expect(updated.status).toBe('cancelled');
      expect(updated.completedAt).toBeDefined();
    });

    it('persists extra fields: result, sessionId, attempt, baseCommit', () => {
      // Create a session to satisfy FK constraint
      const now = Date.now();
      db.prepare(
        `INSERT INTO sessions (id, project_id, name, created_at, updated_at)
         VALUES (?, ?, 'Test Session', ?, ?)`,
      ).run('sess-1', projectId, now, now);

      const task = repo.create({
        projectId,
        title: 'Extras',
        description: 'd',
        source: 'user',
        status: 'pending',
      });

      const result = { summary: 'Done', filesChanged: ['a.ts', 'b.ts'] };
      repo.updateStatus(task.id, 'running', {
        result,
        sessionId: 'sess-1',
        attempt: 2,
        baseCommit: 'abc123',
      });

      const updated = repo.findById(task.id)!;
      expect(updated.result).toEqual(result);
      expect(updated.sessionId).toBe('sess-1');
      expect(updated.attempt).toBe(2);
      expect(updated.baseCommit).toBe('abc123');
    });
  });

  describe('update()', () => {
    it('updates individual fields', () => {
      const task = repo.create({
        projectId,
        title: 'Old title',
        description: 'Old desc',
        source: 'user',
        status: 'pending',
        priority: 0,
      });

      const updated = repo.update(task.id, {
        title: 'New title',
        description: 'New desc',
        priority: 10,
      });

      expect(updated).toBeDefined();
      expect(updated!.title).toBe('New title');
      expect(updated!.description).toBe('New desc');
      expect(updated!.priority).toBe(10);
    });

    it('updates dependencies and dependencyMode', () => {
      const task = repo.create({
        projectId,
        title: 'Deps',
        description: 'd',
        source: 'user',
        status: 'pending',
      });

      const updated = repo.update(task.id, {
        dependencies: ['task-a', 'task-b'],
        dependencyMode: 'any',
      });

      expect(updated!.dependencies).toEqual(['task-a', 'task-b']);
      expect(updated!.dependencyMode).toBe('any');
    });

    it('updates acceptanceCriteria, relevantDocIds, scope, taskSpecificContext', () => {
      const task = repo.create({
        projectId,
        title: 'Full update',
        description: 'd',
        source: 'user',
        status: 'pending',
      });

      const updated = repo.update(task.id, {
        acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
        relevantDocIds: ['doc1.md', 'doc2.md'],
        scope: ['src/', 'lib/'],
        taskSpecificContext: 'Extra context here',
      });

      expect(updated!.acceptanceCriteria).toEqual(['Criterion 1', 'Criterion 2']);
      expect(updated!.relevantDocIds).toEqual(['doc1.md', 'doc2.md']);
      expect(updated!.scope).toEqual(['src/', 'lib/']);
      expect(updated!.taskSpecificContext).toBe('Extra context here');
    });

    it('returns entity unchanged when data is empty', () => {
      const task = repo.create({
        projectId,
        title: 'No change',
        description: 'd',
        source: 'user',
        status: 'pending',
      });

      const result = repo.update(task.id, {});
      expect(result).toBeDefined();
      expect(result!.title).toBe('No change');
      expect(result!.id).toBe(task.id);
    });

    it('returns undefined for non-existent id', () => {
      const result = repo.update('non-existent', { title: 'test' });
      expect(result).toBeUndefined();
    });
  });

  describe('countByProject()', () => {
    it('returns correct count', () => {
      expect(repo.countByProject(projectId)).toBe(0);

      repo.create({ projectId, title: 'T1', description: 'd', source: 'user', status: 'pending' });
      repo.create({ projectId, title: 'T2', description: 'd', source: 'user', status: 'running' });
      repo.create({ projectId, title: 'T3', description: 'd', source: 'user', status: 'integrated' });

      expect(repo.countByProject(projectId)).toBe(3);
    });

    it('returns 0 for project with no tasks', () => {
      expect(repo.countByProject('empty-project')).toBe(0);
    });
  });

  describe('delete()', () => {
    it('removes the task', () => {
      const task = repo.create({
        projectId,
        title: 'Delete me',
        description: 'd',
        source: 'user',
        status: 'pending',
      });

      expect(repo.findById(task.id)).toBeDefined();

      repo.delete(task.id);

      expect(repo.findById(task.id)).toBeUndefined();
      expect(repo.countByProject(projectId)).toBe(0);
    });

    it('is a no-op for non-existent id', () => {
      // Should not throw
      repo.delete('non-existent-id');
    });
  });
});
