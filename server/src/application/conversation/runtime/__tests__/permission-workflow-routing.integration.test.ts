import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createPermissionCallback } from '../run-permissions.js';
import { PermissionWorkflowResolver } from '../../../../domains/workflows/permission-workflow-resolver.js';

const {
  broadcastRunMessageMock,
  normalizeFromAskUserMock,
  writePermissionLogMock,
} = vi.hoisted(() => ({
  broadcastRunMessageMock: vi.fn(),
  normalizeFromAskUserMock: vi.fn(),
  writePermissionLogMock: vi.fn(),
}));

vi.mock('../../transport/broadcast.js', () => ({
  broadcastRunMessage: broadcastRunMessageMock,
}));

vi.mock('../../interactions/interaction-normalizer.js', () => ({
  normalizeFromAskUser: normalizeFromAskUserMock,
}));

vi.mock('../../agent/permission-log-writer.js', () => ({
  writePermissionLog: writePermissionLogMock,
}));

vi.mock('../../agent/permission-evaluator.js', () => ({
  buildRememberKey: vi.fn(() => 'remember-key'),
  classify: vi.fn(() => 'destructiveOps'),
  extractBashCommand: vi.fn(() => 'grep -n "foo" /tmp/outside/file'),
  getAgentPermissionPolicy: vi.fn(() => ({
    enabled: false,
    profile: {
      fileRead: 'ask',
      fileWrite: 'ask',
      shellSafe: 'ask',
      networkOps: 'ask',
      destructiveOps: 'ask',
      userQuestions: 'ask',
    },
    globalGuards: {
      blockSensitiveFiles: true,
      blockOutsideWorkspace: true,
    },
    customRules: [],
    escalateAlways: [],
    aiReview: {
      enabled: true,
      timeoutBeforeReview: 60,
      confidenceThreshold: 0.8,
      maxAutoApprovalsPerMinute: 10,
    },
  })),
  getMatchedPermissionRule: vi.fn(() => 'Outside workspace access'),
  getOutsideWorkspacePaths: vi.fn(() => ['/tmp/outside/file']),
  getProjectPermissionOverride: vi.fn(() => undefined),
  isInternalInteractionTool: vi.fn(() => false),
  isOutsideWorkspacePathAllowed: vi.fn(() => false),
  mergePolicy: vi.fn((globalPolicy) => globalPolicy),
  normalizePolicy: vi.fn((policy) => policy),
  PermissionEvaluator: class {
    evaluate() {
      return 'ask';
    }
  },
  resolveRememberedDecision: vi.fn(() => undefined),
}));

vi.mock('../../../../utils/server-utils.js', () => ({
  isBashLikeTool: vi.fn(() => true),
  isSudoCommand: vi.fn(() => false),
}));

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      definition TEXT NOT NULL,
      template_id TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      system_key TEXT,
      source_plugin_id TEXT,
      source_type TEXT,
      authoring_mode TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      provider_id TEXT,
      root_path TEXT,
      system_prompt TEXT,
      permission_policy TEXT,
      agent_permission_override TEXT,
      agent TEXT,
      context_sync_status TEXT NOT NULL DEFAULT 'synced',
      review_provider_id TEXT,
      permission_workflow_override_id TEXT,
      is_internal INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE agent_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      project_id TEXT,
      session_id TEXT,
      provider_id TEXT,
      permission_workflow_override_id TEXT,
      permission_policy TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO agent_config (id, enabled, created_at, updated_at) VALUES (1, 1, 1, 1);
  `);
  return db;
}

function insertWorkflow(db: Database.Database, values: {
  id: string;
  status?: string;
  isSystem?: boolean;
  systemKey?: string | null;
}) {
  db.prepare(`
    INSERT INTO workflows (
      id, project_id, name, status, definition, is_system, system_key, created_at, updated_at
    ) VALUES (?, NULL, ?, ?, '{"triggers":[],"nodes":[],"edges":[],"entryNodeId":""}', ?, ?, 1, 1)
  `).run(
    values.id,
    values.id,
    values.status ?? 'active',
    values.isSystem ? 1 : 0,
    values.systemKey ?? null,
  );
}

function createInput(db: Database.Database, resolver: PermissionWorkflowResolver) {
  return {
    activeRun: {
      rememberedDecisions: new Map(),
      allowedOutsideWorkspaceRoots: new Set(),
      pendingPermissions: new Map(),
      workspaceRoot: '/Users/test/workspace',
    },
    cwd: '/Users/test/workspace',
    db: { prepare: vi.fn(() => ({ run: vi.fn() })) },
    forcedPlanBySession: false,
    markPendingResolutionResumed: vi.fn(),
    message: { sessionId: 'session-1' },
    modeValue: 'default',
    notificationService: { notify: vi.fn(async () => {}) },
    permissionBridge: { register: vi.fn(), setWorkflowRunId: vi.fn() },
    permissionWorkflowResolver: resolver,
    providerType: 'codex',
    runId: 'run-1',
    sendRunEvent: vi.fn(),
    session: { project_id: 'project-1' },
    sessionType: 'regular' as const,
  };
}

describe('permission workflow routing integration', () => {
  let db: Database.Database;
  let triggerWorkflowMock: ReturnType<typeof vi.fn>;
  let workflowService: {
    getSystemPermissionFallback: ReturnType<typeof vi.fn>;
    triggerWorkflow: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDb();
    triggerWorkflowMock = vi.fn(async (workflowId: string) => ({
      id: `run-${workflowId}`,
      workflowId,
      status: 'running',
      triggerSource: 'event',
      startedAt: Date.now(),
    }));
    workflowService = {
      getSystemPermissionFallback: vi.fn(() => ({
        id: 'wf-system',
        status: 'active',
        isSystem: true,
        systemKey: 'permission_escalation_fallback',
      })),
      triggerWorkflow: triggerWorkflowMock,
    };
  });

  it('prefers the project override when present', async () => {
    insertWorkflow(db, { id: 'wf-project' });
    insertWorkflow(db, { id: 'wf-global' });
    db.prepare(`
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('project-1', 'Project', 'code', 'wf-project', 1, 1)
    `).run();
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-global' WHERE id = 1`).run();

    const resolver = new PermissionWorkflowResolver(db, workflowService as any);
    const callback = createPermissionCallback(createInput(db, resolver) as any);

    void callback({
      requestId: 'req-project',
      toolName: 'Bash',
      toolInput: { command: 'grep -n "foo" /tmp/outside/file' },
      detail: 'grep -n "foo" /tmp/outside/file',
      timeoutSeconds: 0,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(triggerWorkflowMock).toHaveBeenCalledWith(
      'wf-project',
      'event',
      'event: permission.escalated',
      expect.objectContaining({
        eventPayload: expect.objectContaining({ requestId: 'req-project' }),
      }),
    );
  });

  it('falls back to the global override when the project override is unavailable', async () => {
    insertWorkflow(db, { id: 'wf-global' });
    db.prepare(`
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('project-1', 'Project', 'code', 'wf-missing', 1, 1)
    `).run();
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-global' WHERE id = 1`).run();

    const resolver = new PermissionWorkflowResolver(db, workflowService as any);
    const callback = createPermissionCallback(createInput(db, resolver) as any);

    void callback({
      requestId: 'req-global',
      toolName: 'Bash',
      toolInput: { command: 'grep -n "foo" /tmp/outside/file' },
      detail: 'grep -n "foo" /tmp/outside/file',
      timeoutSeconds: 0,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(triggerWorkflowMock).toHaveBeenCalledWith(
      'wf-global',
      'event',
      'event: permission.escalated',
      expect.any(Object),
    );
  });

  it('falls back to the immutable system workflow when overrides are unavailable', async () => {
    insertWorkflow(db, { id: 'wf-global', status: 'disabled' });
    db.prepare(`
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('project-1', 'Project', 'code', 'wf-missing', 1, 1)
    `).run();
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-global' WHERE id = 1`).run();

    const resolver = new PermissionWorkflowResolver(db, workflowService as any);
    const callback = createPermissionCallback(createInput(db, resolver) as any);

    void callback({
      requestId: 'req-system',
      toolName: 'Bash',
      toolInput: { command: 'grep -n "foo" /tmp/outside/file' },
      detail: 'grep -n "foo" /tmp/outside/file',
      timeoutSeconds: 0,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(triggerWorkflowMock).toHaveBeenCalledWith(
      'wf-system',
      'event',
      'event: permission.escalated',
      expect.any(Object),
    );
    expect(broadcastRunMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requestId: 'req-system',
        workflowMode: true,
      }),
    );
  });

  it('sends permission_request before starting the permission workflow', async () => {
    insertWorkflow(db, { id: 'wf-global' });
    db.prepare(`UPDATE agent_config SET permission_workflow_override_id = 'wf-global' WHERE id = 1`).run();

    const resolver = new PermissionWorkflowResolver(db, workflowService as any);
    const callback = createPermissionCallback(createInput(db, resolver) as any);

    void callback({
      requestId: 'req-order',
      toolName: 'Bash',
      toolInput: { command: 'grep -n "foo" /tmp/outside/file' },
      detail: 'grep -n "foo" /tmp/outside/file',
      timeoutSeconds: 0,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(broadcastRunMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'permission_request',
        requestId: 'req-order',
      }),
    );
    expect(triggerWorkflowMock).toHaveBeenCalledWith(
      'wf-global',
      'event',
      'event: permission.escalated',
      expect.any(Object),
    );
    expect(broadcastRunMessageMock.mock.invocationCallOrder[0])
      .toBeLessThan(triggerWorkflowMock.mock.invocationCallOrder[0]);
  });
});
