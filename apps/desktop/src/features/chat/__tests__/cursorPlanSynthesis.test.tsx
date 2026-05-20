import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useChatStore } from '../../../stores/chatStore';
import { useInteractionStore } from '../../../stores/interactionStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useServerStore } from '../../../stores/serverStore';
import { handleRunMessage } from '../../../services/message-handlers/run-messages';
import type { MessageDispatchContext } from '../../../services/message-handlers/types';

function setupCursorSession() {
  useChatStore.setState({
    activeRuns: { 'run-1': 'session-1' },
    runHealth: {},
    activeToolCalls: {},
    toolCallsHistory: {},
    runContentBlocks: {},
  } as any);

  useProjectStore.setState({
    sessions: [{
      id: 'session-1',
      projectId: 'p-1',
      providerId: 'prov-cursor',
      type: 'regular',
      createdAt: 0,
      updatedAt: 0,
    }],
    providers: [{
      id: 'prov-cursor',
      name: 'Cursor',
      type: 'cursor',
      createdAt: 0,
      updatedAt: 0,
    }],
  } as any);

  useInteractionStore.setState({ interactions: {} } as any);
}

function setupClaudeSession() {
  useChatStore.setState({
    activeRuns: { 'run-1': 'session-1' },
    runHealth: {},
    activeToolCalls: {},
    toolCallsHistory: {},
    runContentBlocks: {},
  } as any);

  useProjectStore.setState({
    sessions: [{
      id: 'session-1',
      projectId: 'p-1',
      providerId: 'prov-claude',
      type: 'regular',
      createdAt: 0,
      updatedAt: 0,
    }],
    providers: [{
      id: 'prov-claude',
      name: 'Claude',
      type: 'claude',
      createdAt: 0,
      updatedAt: 0,
    }],
  } as any);

  useInteractionStore.setState({ interactions: {} } as any);
}

const mockCtx: MessageDispatchContext = {
  serverId: 'srv-1',
  backendId: null,
  serverRunsRef: new Map([['srv-1', new Set(['run-1'])]]),
  resolveBackendName: () => 'local',
  logTag: 'test',
  isStaleRunEvent: () => false,
  isRunEventGap: () => false,
  recoverRunGap: vi.fn(),
  recordTerminalRun: vi.fn(),
  clearRunActivity: vi.fn(),
  clearRunSeq: vi.fn(),
  clearTerminalRunSeq: vi.fn(),
};

describe('Cursor plan synthesiser', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useServerStore.setState({ activeServerId: 'srv-1' } as any);
  });

  it('synthesises an interaction_plan_review on cursor tool_use with plan_proposal semantic', () => {
    setupCursorSession();

    handleRunMessage({
      type: 'tool_use',
      runId: 'run-1',
      seq: 1,
      sessionId: 'session-1',
      toolUseId: 'tool-abc',
      toolName: 'createPlan',
      semantic: 'plan_proposal',
      toolInput: {
        plan: '# Cursor plan',
        todos: [
          { id: 't1', content: 'step one', status: 'TODO_STATUS_PENDING' },
          { id: 't2', content: 'step two', status: 'TODO_STATUS_IN_PROGRESS' },
        ],
      },
    } as any, mockCtx);

    const interaction = useInteractionStore.getState().interactions['tool-abc'];
    expect(interaction).toBeDefined();
    expect(interaction.type).toBe('interaction_plan_review');
    expect((interaction as any).source).toBe('client_synth');
    expect((interaction as any).plan).toBe('# Cursor plan');
    expect((interaction as any).todos).toEqual([
      { content: 'step one', status: 'pending' },
      { content: 'step two', status: 'in_progress' },
    ]);
  });

  it('does not synthesise for Claude provider sessions', () => {
    setupClaudeSession();

    handleRunMessage({
      type: 'tool_use',
      runId: 'run-1',
      seq: 1,
      sessionId: 'session-1',
      toolUseId: 'tool-xyz',
      toolName: 'ExitPlanMode',
      semantic: 'plan_proposal',
      toolInput: { plan: '# Claude plan' },
    } as any, mockCtx);

    expect(useInteractionStore.getState().interactions['tool-xyz']).toBeUndefined();
  });

  it('does not synthesise for non-plan_proposal tools even on cursor sessions', () => {
    setupCursorSession();

    handleRunMessage({
      type: 'tool_use',
      runId: 'run-1',
      seq: 1,
      sessionId: 'session-1',
      toolUseId: 'tool-edit',
      toolName: 'Edit',
      semantic: undefined,
      toolInput: { file_path: '/x', old_string: 'a', new_string: 'b' },
    } as any, mockCtx);

    expect(useInteractionStore.getState().interactions['tool-edit']).toBeUndefined();
  });

  it('preserves the client-synth plan review across run_completed', () => {
    setupCursorSession();

    // 1. tool_use → synthesises a client_synth interaction
    handleRunMessage({
      type: 'tool_use',
      runId: 'run-1',
      seq: 1,
      sessionId: 'session-1',
      toolUseId: 'tool-keep',
      toolName: 'createPlan',
      semantic: 'plan_proposal',
      toolInput: { plan: '# keep me' },
    } as any, mockCtx);

    expect(useInteractionStore.getState().interactions['tool-keep']).toBeDefined();

    // 2. run_completed arrives (Cursor does not block server-side on createPlan)
    handleRunMessage({
      type: 'run_completed',
      runId: 'run-1',
      seq: 2,
      sessionId: 'session-1',
      usage: undefined,
    } as any, mockCtx);

    // 3. client-synth interaction must survive so the user can act on it
    expect(useInteractionStore.getState().interactions['tool-keep']).toBeDefined();
    expect((useInteractionStore.getState().interactions['tool-keep'] as any).source).toBe('client_synth');
  });

  it('still clears non-synth same-session interactions on run_completed', () => {
    setupClaudeSession();

    // Seed a server-driven (tool_call source) plan review interaction
    useInteractionStore.setState({
      interactions: {
        'srv-1': {
          type: 'interaction_plan_review',
          interactionId: 'srv-1',
          sessionId: 'session-1',
          source: 'tool_call',
          createdAt: 0,
          plan: 'X',
        },
      },
    } as any);

    handleRunMessage({
      type: 'run_completed',
      runId: 'run-1',
      seq: 1,
      sessionId: 'session-1',
      usage: undefined,
    } as any, mockCtx);

    expect(useInteractionStore.getState().interactions['srv-1']).toBeUndefined();
  });
});
