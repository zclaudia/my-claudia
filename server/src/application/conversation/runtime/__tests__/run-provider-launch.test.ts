import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildRunContextMock = vi.fn();
const negotiateProfileMock = vi.fn();
const upsertAssistantMessageMock = vi.fn();
const pluginEventsEmitMock = vi.fn(async () => {});

vi.mock('../run-context.js', () => ({
  buildRunContext: buildRunContextMock,
}));

vi.mock('../../../../infrastructure/providers/pcp-negotiator.js', () => ({
  negotiateProfile: negotiateProfileMock,
}));

vi.mock('../run-lifecycle.js', () => ({
  upsertAssistantMessage: upsertAssistantMessageMock,
}));

vi.mock('../../../../events/index.js', () => ({
  pluginEvents: {
    emit: pluginEventsEmitMock,
  },
}));

async function* providerStream() {
  yield {
    type: 'result',
    content: 'done',
    usage: { inputTokens: 1, outputTokens: 2 },
  } as any;
}

describe('ws/run-provider-launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    buildRunContextMock.mockResolvedValue({
      nativeMode: 'default',
      runOptions: {
        cwd: '/tmp/project',
        mode: 'default',
      },
    });
    negotiateProfileMock.mockReturnValue({
      providerId: 'pcp-claude',
      capabilities: [{ id: 'edit', enabled: true, mode: 'native', reliability: 'high' }],
    });
  });

  it('emits run_started, background status, negotiates profile, and starts periodic save', async () => {
    const { launchProviderRun } = await import('../run-provider-launch.js');

    const trace = {
      log: vi.fn(),
      setMeta: vi.fn(),
    };
    const activeRun = {
      assistantMessageId: 'assistant-1',
    } as any;
    const permissionCallback = vi.fn();
    const adapter = {
      manifest: { id: 'claude' },
      run: vi.fn(() => providerStream()),
      getRunState: vi.fn(() => ({ providerSessionId: 'sdk-1', providerCwd: '/tmp/project' })),
    } as any;
    const sendRunEventMock = vi.fn();
    const broadcastSessionCatalogUpdateMock = vi.fn();

    const result = await launchProviderRun({
      activeRun,
      adapter,
      broadcastSessionCatalogUpdate: broadcastSessionCatalogUpdateMock,
      client: { ws: {} as any } as any,
      cwd: '/tmp/project',
      db: {} as any,
      forcedPlanBySession: false,
      message: {
        type: 'run_start',
        sessionId: 'session-1',
        clientRequestId: 'req-1',
        input: 'hello',
        model: 'sonnet',
      },
      modeValue: 'default',
      permissionCallback,
      processedInput: 'processed hello',
      providerConfig: { id: 'provider-1', type: 'claude', cliPath: '/usr/bin/claude' } as any,
      providerId: 'provider-1',
      providerType: 'claude',
      runId: 'run-1',
      sdkSessionId: 'sdk-prev',
      sendRunEvent: sendRunEventMock,
      serverPort: 3100,
      session: {
        id: 'session-1',
        project_id: 'project-1',
        name: 'Test Session',
        root_path: '/tmp/project',
        sdk_session_id: 'sdk-prev',
        session_type: 'background',
        working_directory: '/tmp/project',
        project_role: null,
        plan_status: null,
        task_id: null,
        provider_id: 'provider-1',
        system_prompt: null,
      },
      sessionType: 'background',
      trace: trace as any,
      userMessageId: 'user-1',
    });

    expect(negotiateProfileMock).toHaveBeenCalled();
    expect(activeRun.effectiveProfile).toEqual(expect.objectContaining({
      providerId: 'pcp-claude',
      sessionId: 'session-1',
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_started',
      runId: 'run-1',
      sessionId: 'session-1',
      clientRequestId: 'req-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
      sessionType: 'background',
    }));
    expect(broadcastSessionCatalogUpdateMock).toHaveBeenCalled();
    expect(pluginEventsEmitMock).toHaveBeenCalledWith('run.started', expect.objectContaining({
      runId: 'run-1',
      sessionId: 'session-1',
      providerId: 'provider-1',
      providerType: 'claude',
    }));
    expect(sendRunEventMock).toHaveBeenCalledWith({
      type: 'background_task_update',
      sessionId: 'session-1',
      status: 'running',
    });
    expect(buildRunContextMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/project',
      providerType: 'claude',
      sdkSessionId: 'sdk-prev',
      sessionType: 'background',
    }));
    expect(adapter.run).toHaveBeenCalledWith('processed hello', { cwd: '/tmp/project', mode: 'default' }, permissionCallback);
    expect(activeRun.providerType).toBe('claude');
    expect(activeRun.providerSessionId).toBe('sdk-1');
    expect(activeRun.providerCwd).toBe('/tmp/project');
    expect(trace.setMeta).toHaveBeenCalledWith({ provider: 'claude', cwd: '/tmp/project' });
    expect(result.providerRunner).toBeTruthy();

    vi.advanceTimersByTime(5000);
    expect(upsertAssistantMessageMock).toHaveBeenCalledWith(activeRun);

    clearInterval(activeRun.saveInterval);
  });
});
