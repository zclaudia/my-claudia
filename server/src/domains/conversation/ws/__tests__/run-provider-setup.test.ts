import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

const createPermissionCallbackMock = vi.fn(() => vi.fn());
const runAIReviewCliJobMock = vi.fn(async () => ({
  decision: 'approve',
  reasoning: 'ok',
  confidence: 0.9,
}));

vi.mock('../run-permissions.js', () => ({
  createPermissionCallback: createPermissionCallbackMock,
}));

vi.mock('../../../../providers/cli-jobs/review-job.js', () => ({
  runAIReviewCliJob: runAIReviewCliJobMock,
  supportsAIReviewCliJob: vi.fn(() => true),
}));

describe('ws/run-provider-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores malformed provider env JSON for AI review providers', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        cli_path TEXT,
        env TEXT
      );
    `);
    db.prepare(`
      INSERT INTO providers (id, type, cli_path, env)
      VALUES ('provider-1', 'claude', '/usr/bin/claude', '{bad json')
    `).run();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { prepareProviderRun } = await import('../run-provider-setup.js');

    const activeRun = {
      pendingPermissions: new Map(),
    } as any;

    prepareProviderRun({
      activeRun,
      aiReviewSystemPrompt: 'system',
      broadcastToOtherAuthenticatedClients: vi.fn(),
      client: { id: 'client-1', ws: {} as any, isAlive: true, isLocal: true, authenticated: true },
      connectedClients: new Map(),
      cwd: '/tmp/project',
      db: db as any,
      markPendingResolutionResumed: vi.fn(),
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        input: 'hello',
        clientRequestId: 'req-1',
        model: 'sonnet',
      },
      notificationService: {} as any,
      onAIReviewResolved: vi.fn(),
      providerConfig: { id: 'provider-1', type: 'claude', env: { BASE: '1' } } as any,
      providerId: 'provider-1',
      providerType: 'claude',
      runId: 'run-1',
      sendMessage: vi.fn(),
      sendRunEvent: vi.fn(),
      session: {
        id: 'session-1',
        project_id: 'project-1',
        root_path: '/tmp/project',
        project_role: null,
        plan_status: null,
      } as any,
      sessionType: 'regular',
    });

    const providerFactory = (activeRun.aiReviewQueue as any).options.createProvider as
      | ((analysisProviderId?: string) => { runPrompt: (prompt: string) => Promise<{ response: string }> })
      | undefined;

    expect(providerFactory).toBeTypeOf('function');
    const provider = providerFactory?.();
    await provider.runPrompt('review this');

    expect(runAIReviewCliJobMock).toHaveBeenCalledWith('claude', expect.objectContaining({
      env: { BASE: '1' },
    }));
    expect(warnSpy).toHaveBeenCalledWith(
      '[AI Review] Failed to parse provider env for provider-1:',
      expect.any(String),
    );
    warnSpy.mockRestore();
  });
});
