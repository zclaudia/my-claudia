import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPermissionCallback } from '../run-permissions.js';

const {
  broadcastRunMessageMock,
  normalizeFromAskUserMock,
  permissionEvaluatorEvaluateMock,
  writePermissionLogMock,
  permissionWorkflowResolverMock,
} = vi.hoisted(() => ({
  broadcastRunMessageMock: vi.fn(),
  normalizeFromAskUserMock: vi.fn(),
  permissionEvaluatorEvaluateMock: vi.fn(() => 'ask'),
  writePermissionLogMock: vi.fn(),
  permissionWorkflowResolverMock: {
    triggerPermissionEscalation: vi.fn(async () => ({
      resolved: { workflowId: 'wf-system', source: 'system_fallback' },
      run: { id: 'wf-run-1' },
    })),
  },
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
    evaluate(...args: unknown[]) {
      return permissionEvaluatorEvaluateMock(...args);
    }
  },
  resolveRememberedDecision: vi.fn(() => undefined),
}));

vi.mock('../../../../utils/server-utils.js', () => ({
  isBashLikeTool: vi.fn(() => true),
  isSudoCommand: vi.fn(() => false),
}));

function createInput() {
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
    permissionWorkflowResolver: permissionWorkflowResolverMock,
    providerType: 'codex',
    runId: 'run-1',
    sendRunEvent: vi.fn(),
    session: { project_id: 'project-1' },
    sessionType: 'regular' as const,
  };
}

describe('createPermissionCallback workflow routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionWorkflowResolverMock.triggerPermissionEscalation.mockResolvedValue({
      resolved: { workflowId: 'wf-system', source: 'system_fallback' },
      run: { id: 'wf-run-1' },
    });
    permissionEvaluatorEvaluateMock.mockReturnValue('ask');
  });

  it('triggers the resolved permission workflow and marks the request as workflow mode', async () => {
    const input = createInput() as any;
    const callback = createPermissionCallback(input);

    void callback({
      requestId: 'req-1',
      toolName: 'Bash',
      toolInput: { command: 'grep -n "foo" /tmp/outside/file' },
      detail: 'grep -n "foo" /tmp/outside/file',
      timeoutSeconds: 0,
    });

    expect(permissionWorkflowResolverMock.triggerPermissionEscalation).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        eventPayload: expect.objectContaining({ requestId: 'req-1', toolName: 'Bash' }),
      }),
    );
    expect(broadcastRunMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'permission_request',
        requestId: 'req-1',
        workflowMode: true,
      }),
    );
    await Promise.resolve();
    expect(input.permissionBridge.setWorkflowRunId).toHaveBeenCalledWith('req-1', 'wf-run-1');
  });

  it('keeps manual approval available if workflow triggering fails', async () => {
    permissionWorkflowResolverMock.triggerPermissionEscalation.mockRejectedValue(new Error('boom'));
    const callback = createPermissionCallback(createInput() as any);

    void callback({
      requestId: 'req-2',
      toolName: 'Bash',
      toolInput: { command: 'grep -n "foo" /tmp/outside/file' },
      detail: 'grep -n "foo" /tmp/outside/file',
      timeoutSeconds: 0,
    });

    expect(broadcastRunMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'permission_request',
        requestId: 'req-2',
        workflowMode: true,
      }),
    );
  });

  it('keeps AskUserQuestion waiting for user answer and does not delegate to permission workflow', () => {
    normalizeFromAskUserMock.mockReturnValue({
      type: 'interaction_prompt',
      interactionId: 'question-1',
      sessionId: 'session-1',
      source: 'provider_native',
      createdAt: 123,
      title: 'Question',
      fields: [],
      responseMode: 'prompt_answer',
    });
    const input = createInput() as any;
    const callback = createPermissionCallback(input);
    permissionEvaluatorEvaluateMock.mockReturnValue('approve');

    void callback({
      requestId: 'question-1',
      toolName: 'AskUserQuestion',
      toolInput: {
        questions: [{
          question: 'Continue?',
          options: [{ label: 'Yes', description: 'Proceed' }],
        }],
      },
      detail: '{"questions":[{"question":"Continue?"}]}',
      timeoutSeconds: 0,
    });

    expect(permissionWorkflowResolverMock.triggerPermissionEscalation).not.toHaveBeenCalled();
    expect(permissionEvaluatorEvaluateMock).not.toHaveBeenCalled();
    expect(input.permissionBridge.register).not.toHaveBeenCalled();
    expect(input.activeRun.pendingPermissions.has('question-1')).toBe(true);
    expect(input.sendRunEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'interaction_prompt',
      interactionId: 'question-1',
      responseMode: 'prompt_answer',
    }));
  });
});
