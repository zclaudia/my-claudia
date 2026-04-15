import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createDebugRoutes } from '../debug.js';
import type { PermissionWorkflowResolver } from '../../../domains/workflows/permission-workflow-resolver.js';

vi.mock('../../../application/conversation/agent/delegation-evaluator.js', () => ({
  evaluateAIReview: vi.fn(),
}));

vi.mock('../../../infrastructure/providers/cli-jobs/review-job.js', () => ({
  supportsAIReviewCliJob: vi.fn((type: string) => ['claude', 'kimi', 'cursor', 'opencode', 'codex'].includes(type)),
  runAIReviewCliJob: vi.fn(),
}));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      cli_path TEXT,
      env TEXT
    );

    CREATE TABLE workflow_step_runs (
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      started_at INTEGER NOT NULL
    );

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
  `);
  db.prepare('INSERT INTO agent_config (id, enabled, created_at, updated_at) VALUES (1, 1, 1, 1)').run();
  return db;
}

function createTestApp(db: Database.Database, options: Parameters<typeof createDebugRoutes>) {
  const app = express();
  app.use(express.json());
  app.use('/api/debug', createDebugRoutes(...options));
  return app;
}

describe('debug routes', () => {
  let db: Database.Database;

  beforeEach(() => {
    db?.close();
    db = createTestDb();
    db.prepare('INSERT INTO providers (id, type, cli_path, env) VALUES (?, ?, ?, ?)')
      .run('provider-1', 'claude', '/bin/claude', '{"TEST_FLAG":true}');
  });

  it('returns an explicit error when runtime mode is requested without OneShotTaskRuntime', async () => {
    const app = createTestApp(db, [undefined, db, undefined, undefined]);

    const res = await request(app)
      .post('/api/debug/simulate-ai-review')
      .send({
        toolName: 'Bash',
        detail: 'echo hello',
        cwd: '/workspace',
        providerId: 'provider-1',
        mode: 'runtime',
      });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'NO_RUNTIME' },
    });
  });

  it('resolves the effective permission workflow for a project', async () => {
    db.prepare(`
      INSERT INTO workflows (id, project_id, name, status, definition, is_system, created_at, updated_at)
      VALUES ('wf-project', NULL, 'Project Workflow', 'active', '{"triggers":[],"nodes":[],"edges":[],"entryNodeId":""}', 0, 1, 1)
    `).run();
    db.prepare(`
      INSERT INTO projects (id, name, type, permission_workflow_override_id, created_at, updated_at)
      VALUES ('project-1', 'Project', 'code', 'wf-project', 1, 1)
    `).run();
    const permissionWorkflowResolver = {
      resolve: vi.fn(() => ({
        workflowId: 'wf-project',
        source: 'project_override',
        workflow: {
          id: 'wf-project',
          name: 'Project Workflow',
          projectId: null,
          status: 'active',
          isSystem: false,
        },
      })),
    } as unknown as PermissionWorkflowResolver;
    const app = createTestApp(db, [undefined, db, undefined, undefined, permissionWorkflowResolver]);

    const res = await request(app)
      .post('/api/debug/resolve-permission-workflow')
      .send({ projectId: 'project-1' });

    expect(res.status).toBe(200);
    expect(permissionWorkflowResolver.resolve).toHaveBeenCalledWith('project-1');
    expect(res.body.data).toMatchObject({
      projectId: 'project-1',
      source: 'project_override',
      workflowId: 'wf-project',
      fallbackReason: null,
      workflow: {
        id: 'wf-project',
        name: 'Project Workflow',
        status: 'active',
        isSystem: false,
      },
    });
  });

  it('uses OneShotTaskRuntime in runtime mode and returns runtime telemetry', async () => {
    const oneShotRuntime = {
      run: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          decision: 'approve',
          reasoning: 'looks safe',
          confidence: 0.91,
        },
        rawText: '{"decision":"approve"}',
        usedFallback: false,
        stopReason: 'structured_submit',
        telemetry: {
          taskType: 'ai_review',
          providerType: 'claude',
          resultType: 'ai_review_v1',
          durationMs: 42,
          validationFailures: 0,
          finalized: true,
          usedFallback: false,
          toolSubmissionAttempts: 1,
        },
      }),
    };
    const app = createTestApp(db, [undefined, db, oneShotRuntime as any, undefined]);

    const res = await request(app)
      .post('/api/debug/simulate-ai-review')
      .send({
        toolName: 'Bash',
        toolInput: { command: 'echo hello' },
        detail: 'echo hello',
        cwd: '/workspace',
        providerId: 'provider-1',
        mode: 'runtime',
      });

    expect(res.status).toBe(200);
    expect(oneShotRuntime.run).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'ai_review',
      providerType: 'claude',
      cwd: '/workspace',
      timeoutMs: 120000,
      systemPrompt: expect.stringContaining('machine-only security review helper'),
      prompt: expect.stringContaining('Tool: Bash'),
    }));
    expect(res.body.data).toMatchObject({
      decision: 'approve',
      reasoning: 'looks safe',
      confidence: 0.91,
      providerId: 'provider-1',
      providerType: 'claude',
      mode: 'runtime',
      telemetry: {
        finalized: true,
        durationMs: 42,
      },
    });
  });

  it('returns an explicit error when workflow mode is requested without WorkflowEngine', async () => {
    const app = createTestApp(db, [undefined, db, undefined, undefined]);

    const res = await request(app)
      .post('/api/debug/simulate-ai-review')
      .send({
        toolName: 'Bash',
        detail: 'echo hello',
        cwd: '/workspace',
        providerId: 'provider-1',
        mode: 'workflow',
      });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'NO_ENGINE' },
    });
  });

  it('runs the permission workflow and returns persisted step outputs in workflow mode', async () => {
    const handlers: Array<(event: Record<string, unknown>) => void> = [];
    const workflowRunId = 'run-123';
    const workflowEngine = {
      dispatcher: {
        onAny: vi.fn((handler: (event: Record<string, unknown>) => void) => {
          handlers.push(handler);
        }),
      },
      startRun: vi.fn(async () => {
        queueMicrotask(() => {
          for (const handler of handlers) {
            handler({
              type: 'run_completed',
              runId: workflowRunId,
              timestamp: Date.now(),
            });
          }
        });
        return {
          id: workflowRunId,
          workflowId: 'wf-1',
          status: 'running',
        };
      }),
    };

    db.prepare('INSERT INTO workflow_step_runs (run_id, node_id, status, output, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(workflowRunId, 'ai_review', 'completed', JSON.stringify({
        decision: 'deny',
        reasoning: 'contains escalation',
        confidence: 0.87,
        metadata: { source: 'runtime' },
      }), Date.now());
    db.prepare('INSERT INTO workflow_step_runs (run_id, node_id, status, output, started_at) VALUES (?, ?, ?, ?, ?)')
      .run(workflowRunId, 'decide_approve', 'completed', JSON.stringify({
        decision: 'deny',
      }), Date.now() + 1);

    const app = createTestApp(db, [undefined, db, undefined, workflowEngine as any]);

    const res = await request(app)
      .post('/api/debug/simulate-ai-review')
      .send({
        toolName: 'Bash',
        toolInput: { command: 'sudo make install' },
        detail: 'sudo make install',
        cwd: '/workspace',
        providerId: 'provider-1',
        mode: 'workflow',
      });

    expect(res.status).toBe(200);
    expect(workflowEngine.startRun).toHaveBeenCalledWith(
      expect.stringContaining('debug-workflow-'),
      undefined,
      expect.objectContaining({
        entryNodeId: expect.any(String),
      }),
      'manual',
      'Debug AI review simulation (workflow mode)',
      expect.objectContaining({
        eventPayload: expect.objectContaining({
          toolName: 'Bash',
          detail: 'sudo make install',
          cwd: '/workspace',
        }),
      }),
    );
    expect(res.body.data).toMatchObject({
      decision: 'deny',
      reasoning: 'contains escalation',
      confidence: 0.87,
      providerId: 'provider-1',
      providerType: 'claude',
      mode: 'workflow',
      workflowRunId,
      workflowStatus: 'completed',
      workflowDecision: 'deny',
    });
    expect(res.body.data.steps).toEqual([
      {
        nodeId: 'ai_review',
        status: 'completed',
        output: {
          decision: 'deny',
          reasoning: 'contains escalation',
          confidence: 0.87,
          metadata: { source: 'runtime' },
        },
      },
      {
        nodeId: 'decide_approve',
        status: 'completed',
        output: {
          decision: 'deny',
        },
      },
    ]);
  });
});
