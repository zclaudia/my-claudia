import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createDebugRoutes } from '../debug.js';

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
  `);
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
