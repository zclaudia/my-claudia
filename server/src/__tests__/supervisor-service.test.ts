import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

// The shared Map instance that will be injected into the mock.
// vi.mock is hoisted, so we use vi.hoisted() to make it available.
const { mockActiveRuns } = vi.hoisted(() => ({
  mockActiveRuns: new Map<string, { sessionId: string; clientId: string }>(),
}));

vi.mock('../server.js', () => ({
  createVirtualClient: vi.fn((clientId: string, opts: { send: (msg: any) => void }) => ({
    id: clientId,
    ws: {
      readyState: 1,
      send: (data: string) => opts.send(JSON.parse(data)),
    },
    authenticated: true,
    isAlive: true,
  })),
  handleRunStart: vi.fn(),
  activeRuns: mockActiveRuns,
  sendMessage: vi.fn(),
}));

import { SupervisorService } from '../services/supervisor-service.js';
import { handleRunStart } from '../server.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'claude',
      cli_path TEXT,
      env TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
      provider_id TEXT,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      agent_permission_override TEXT,
      is_internal INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      provider_id TEXT,
      sdk_session_id TEXT,
      type TEXT DEFAULT 'regular',
      parent_session_id TEXT,
      archived_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_offset ON messages(session_id, offset);

    CREATE TABLE IF NOT EXISTS supervisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      subtasks TEXT,
      status TEXT CHECK(status IN ('planning', 'active', 'paused', 'completed', 'failed', 'cancelled')) NOT NULL DEFAULT 'active',
      max_iterations INTEGER NOT NULL DEFAULT 10,
      current_iteration INTEGER NOT NULL DEFAULT 0,
      cooldown_seconds INTEGER NOT NULL DEFAULT 5,
      last_run_id TEXT,
      error_message TEXT,
      plan_session_id TEXT,
      acceptance_criteria TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS supervision_logs (
      id TEXT PRIMARY KEY,
      supervision_id TEXT NOT NULL,
      iteration INTEGER,
      event TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  return db;
}

function createTestSession(db: Database.Database): { projectId: string; sessionId: string } {
  const projectId = uuidv4();
  const sessionId = uuidv4();
  const now = Date.now();

  db.prepare(`INSERT INTO projects (id, name, type, created_at, updated_at)
    VALUES (?, ?, 'code', ?, ?)`).run(projectId, 'Test Project', now, now);
  db.prepare(`INSERT INTO sessions (id, project_id, name, created_at, updated_at)
    VALUES (?, ?, 'Test Session', ?, ?)`).run(sessionId, projectId, now, now);

  return { projectId, sessionId };
}

describe('SupervisorService', () => {
  let db: Database.Database;
  let service: SupervisorService;

  beforeAll(() => {
    db = createTestDb();
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    // Clear data
    db.exec('DELETE FROM supervision_logs');
    db.exec('DELETE FROM supervisions');
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM projects');
    mockActiveRuns.clear();
    vi.clearAllMocks();

    service = new SupervisorService(db);
  });

  describe('CRUD lifecycle', () => {
    it('should create a supervision with status active', () => {
      const { sessionId } = createTestSession(db);
      const sup = service.create(sessionId, 'Implement feature X');

      expect(sup).toBeDefined();
      expect(sup.sessionId).toBe(sessionId);
      expect(sup.goal).toBe('Implement feature X');
      expect(sup.status).toBe('active');
      expect(sup.currentIteration).toBe(0);
      expect(sup.maxIterations).toBe(5); // default for no subtasks
    });

    it('should create a supervision with subtasks and dynamic maxIterations', () => {
      const { sessionId } = createTestSession(db);
      const sup = service.create(sessionId, 'Build auth system', {
        subtasks: ['Setup JWT', 'Create login endpoint', 'Add middleware'],
      });

      expect(sup.subtasks).toHaveLength(3);
      expect(sup.subtasks![0].id).toBe(1);
      expect(sup.subtasks![0].status).toBe('pending');
      expect(sup.maxIterations).toBe(9); // 3 * 3
    });

    it('should respect explicit maxIterations over dynamic default', () => {
      const { sessionId } = createTestSession(db);
      const sup = service.create(sessionId, 'Quick task', { maxIterations: 2 });

      expect(sup.maxIterations).toBe(2);
    });

    it('should throw when session already has an active supervision', () => {
      const { sessionId } = createTestSession(db);
      service.create(sessionId, 'First supervision');

      expect(() => service.create(sessionId, 'Second supervision'))
        .toThrow('Session already has an active supervision');
    });

    it('should pause a supervision', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      const paused = service.pause(created.id);

      expect(paused.status).toBe('paused');
    });

    it('should resume a paused supervision', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      service.pause(created.id);
      const resumed = service.resume(created.id);

      expect(resumed.status).toBe('active');
    });

    it('should resume with updated maxIterations', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal', { maxIterations: 2 });
      service.pause(created.id);
      const resumed = service.resume(created.id, { maxIterations: 20 });

      expect(resumed.maxIterations).toBe(20);
      expect(resumed.status).toBe('active');
    });

    it('should throw when resuming a non-paused supervision', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');

      expect(() => service.resume(created.id)).toThrow('not paused');
    });

    it('should cancel a supervision', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      const cancelled = service.cancel(created.id);

      expect(cancelled.status).toBe('cancelled');
    });

    it('should allow creating new supervision after cancelling', () => {
      const { sessionId } = createTestSession(db);
      const first = service.create(sessionId, 'First');
      service.cancel(first.id);
      const second = service.create(sessionId, 'Second');

      expect(second.status).toBe('active');
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('update', () => {
    it('should update maxIterations', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      const updated = service.update(created.id, { maxIterations: 50 });

      expect(updated.maxIterations).toBe(50);
    });

    it('should update goal', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Old goal');
      const updated = service.update(created.id, { goal: 'New goal' });

      expect(updated.goal).toBe('New goal');
    });
  });

  describe('queries', () => {
    it('should get supervision by ID', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      const fetched = service.getSupervision(created.id);

      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
    });

    it('should return null for non-existent supervision', () => {
      expect(service.getSupervision('non-existent')).toBeNull();
    });

    it('should get active supervision by session ID', () => {
      const { sessionId } = createTestSession(db);
      service.create(sessionId, 'Active goal');
      const found = service.getActiveBySessionId(sessionId);

      expect(found).toBeDefined();
      expect(found!.goal).toBe('Active goal');
    });

    it('should return null for session with no active supervision', () => {
      const { sessionId } = createTestSession(db);
      expect(service.getActiveBySessionId(sessionId)).toBeNull();
    });

    it('should list all supervisions', () => {
      const { sessionId: s1 } = createTestSession(db);
      const { sessionId: s2 } = createTestSession(db);
      service.create(s1, 'Goal 1');
      service.create(s2, 'Goal 2');

      const list = service.listAll();
      expect(list).toHaveLength(2);
    });
  });

  describe('logging', () => {
    it('should record logs for pause operation', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      service.pause(created.id, 'user');

      const logs = service.getLogsBySupervisionId(created.id);
      const pauseLog = logs.find(l => l.event === 'paused');

      expect(pauseLog).toBeDefined();
      expect(pauseLog!.detail).toEqual({ reason: 'user' });
    });

    it('should record logs for resume operation', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      service.pause(created.id);
      service.resume(created.id);

      const logs = service.getLogsBySupervisionId(created.id);
      const resumeLog = logs.find(l => l.event === 'resumed');
      expect(resumeLog).toBeDefined();
    });

    it('should record logs for cancel operation', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      service.cancel(created.id);

      const logs = service.getLogsBySupervisionId(created.id);
      const cancelLog = logs.find(l => l.event === 'cancelled');
      expect(cancelLog).toBeDefined();
    });

    it('should return logs in chronological order', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');
      service.pause(created.id);
      service.resume(created.id);
      service.cancel(created.id);

      const logs = service.getLogsBySupervisionId(created.id);
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i].createdAt).toBeGreaterThanOrEqual(logs[i - 1].createdAt);
      }
    });
  });

  describe('broadcast', () => {
    it('should call broadcast function on status changes', () => {
      const broadcastFn = vi.fn();
      service.setBroadcast(broadcastFn);

      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Test goal');

      // Pause triggers broadcast
      service.pause(created.id);

      // broadcastUpdate is called from pause() → updateStatus() + appendLog()
      const calls = broadcastFn.mock.calls;
      expect(calls.length).toBeGreaterThan(0);

      // At least one call should have the supervision update message
      const supUpdateCall = calls.find(
        (c: any[]) => c[0]?.type === 'supervision_update'
      );
      expect(supUpdateCall).toBeDefined();
    });
  });

  describe('planning lifecycle', () => {
    it('should create a supervision in planning status without plan session', () => {
      const { sessionId } = createTestSession(db);
      const result = service.startPlanning(sessionId, 'Build a feature');

      expect(result.supervision).toBeDefined();
      expect(result.supervision.status).toBe('planning');
      expect(result.supervision.goal).toBe('Build a feature');
      // No plan session created — planning happens in the main session
      expect(result.supervision.planSessionId).toBeUndefined();
    });

    it('should log planning_started event', () => {
      const { sessionId } = createTestSession(db);
      const result = service.startPlanning(sessionId, 'Test');

      const logs = service.getLogsBySupervisionId(result.supervision.id);
      expect(logs.some(l => l.event === 'planning_started')).toBe(true);
    });

    it('should throw when session already has a planning supervision', () => {
      const { sessionId } = createTestSession(db);
      service.startPlanning(sessionId, 'First');

      expect(() => service.startPlanning(sessionId, 'Second'))
        .toThrow('Session already has an active supervision');
    });

    it('should throw when session has an active supervision and trying to plan', () => {
      const { sessionId } = createTestSession(db);
      service.create(sessionId, 'Active supervision');

      expect(() => service.startPlanning(sessionId, 'Try to plan'))
        .toThrow('Session already has an active supervision');
    });

    it('should not call handleRunStart when starting planning (no background session)', () => {
      const { sessionId } = createTestSession(db);
      (handleRunStart as any).mockClear();

      service.startPlanning(sessionId, 'Test');

      // startPlanning no longer triggers handleRunStart — client sends the first message
      expect(handleRunStart).not.toHaveBeenCalled();
    });

    it('should return planning system prompt for session in planning status', () => {
      const { sessionId } = createTestSession(db);
      service.startPlanning(sessionId, 'Test');

      const prompt = service.getPlanningSystemPromptForSession(sessionId);
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('goal planning assistant');
    });

    it('should return null planning prompt for session without planning supervision', () => {
      const { sessionId } = createTestSession(db);

      const prompt = service.getPlanningSystemPromptForSession(sessionId);
      expect(prompt).toBeNull();
    });

    it('should approve plan and transition to active status', () => {
      const { sessionId } = createTestSession(db);
      const result = service.startPlanning(sessionId, 'Build feature');

      const approved = service.approvePlan(result.supervision.id, {
        goal: 'Build complete auth system',
        subtasks: [
          { description: 'Setup JWT', phase: 1, acceptanceCriteria: ['JWT tokens generated'] },
          { description: 'Create login endpoint', phase: 1, acceptanceCriteria: ['POST /login works'] },
          { description: 'Add auth middleware', phase: 2, acceptanceCriteria: ['Protected routes require token'] },
        ],
        acceptanceCriteria: ['All endpoints secured', 'Tests pass'],
      });

      expect(approved.status).toBe('active');
      expect(approved.goal).toBe('Build complete auth system');
      expect(approved.subtasks).toHaveLength(3);
      expect(approved.subtasks![0].phase).toBe(1);
      expect(approved.subtasks![0].acceptanceCriteria).toEqual(['JWT tokens generated']);
      expect(approved.subtasks![2].phase).toBe(2);
      expect(approved.acceptanceCriteria).toEqual(['All endpoints secured', 'Tests pass']);
      expect(approved.maxIterations).toBe(9); // 3 * 3
    });

    it('should use custom maxIterations when approving plan', () => {
      const { sessionId } = createTestSession(db);
      const result = service.startPlanning(sessionId, 'Test');

      const approved = service.approvePlan(result.supervision.id, {
        goal: 'Custom iterations goal',
        subtasks: [{ description: 'Task 1' }],
        maxIterations: 20,
      });

      expect(approved.maxIterations).toBe(20);
    });

    it('should log planning_approved event with details', () => {
      const { sessionId } = createTestSession(db);
      const result = service.startPlanning(sessionId, 'Test');

      service.approvePlan(result.supervision.id, {
        goal: 'Final goal',
        subtasks: [{ description: 'Task 1' }, { description: 'Task 2' }],
        acceptanceCriteria: ['Criterion 1'],
      });

      const logs = service.getLogsBySupervisionId(result.supervision.id);
      const approveLog = logs.find(l => l.event === 'planning_approved');
      expect(approveLog).toBeDefined();
      expect(approveLog!.detail).toEqual({
        goal: 'Final goal',
        subtaskCount: 2,
        acceptanceCriteriaCount: 1,
      });
    });

    it('should throw when approving non-planning supervision', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Active');

      expect(() => service.approvePlan(created.id, {
        goal: 'Test',
        subtasks: [],
      })).toThrow('not in planning status');
    });

    it('should cancel a planning supervision', () => {
      const { sessionId } = createTestSession(db);
      const result = service.startPlanning(sessionId, 'Will cancel');

      const cancelled = service.cancelPlanning(result.supervision.id);
      expect(cancelled.status).toBe('cancelled');
    });

    it('should log planning_cancelled event', () => {
      const { sessionId } = createTestSession(db);
      const result = service.startPlanning(sessionId, 'Will cancel');

      service.cancelPlanning(result.supervision.id);

      const logs = service.getLogsBySupervisionId(result.supervision.id);
      expect(logs.some(l => l.event === 'planning_cancelled')).toBe(true);
    });

    it('should throw when cancelling non-planning supervision', () => {
      const { sessionId } = createTestSession(db);
      const created = service.create(sessionId, 'Active');

      expect(() => service.cancelPlanning(created.id))
        .toThrow('not in planning status');
    });

    it('should allow creating new supervision after cancelling planning', () => {
      const { sessionId } = createTestSession(db);
      const result = service.startPlanning(sessionId, 'Planning');
      service.cancelPlanning(result.supervision.id);

      const created = service.create(sessionId, 'Now active');
      expect(created.status).toBe('active');
    });

    it('should include planning status in getActiveBySessionId', () => {
      const { sessionId } = createTestSession(db);
      service.startPlanning(sessionId, 'Planning goal');

      const found = service.getActiveBySessionId(sessionId);
      expect(found).toBeDefined();
      expect(found!.status).toBe('planning');
    });

  });

  describe('acceptance criteria in prompts', () => {
    it('should include acceptance criteria in initial prompt for active supervision', () => {
      const { sessionId } = createTestSession(db);

      // Create via planning flow to get acceptance criteria
      const result = service.startPlanning(sessionId, 'Build feature');
      service.approvePlan(result.supervision.id, {
        goal: 'Build auth',
        subtasks: [
          { description: 'Setup JWT', phase: 1, acceptanceCriteria: ['Tokens work'] },
        ],
        acceptanceCriteria: ['All secure', 'Tests pass'],
      });

      // Verify the supervision has acceptance criteria stored
      const sup = service.getSupervision(result.supervision.id);
      expect(sup!.acceptanceCriteria).toEqual(['All secure', 'Tests pass']);
      expect(sup!.subtasks![0].acceptanceCriteria).toEqual(['Tokens work']);
    });
  });
});
