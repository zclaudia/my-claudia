import { describe, expect, it } from 'vitest';
import {
  mapACPPromptResult,
  mapACPSessionUpdate,
} from '../acp/message-mapper.js';

describe('ACP message mapper', () => {
  it('maps agent message chunks to assistant messages', () => {
    expect(mapACPSessionUpdate({
      sessionId: 'acp-session',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello from ACP' },
      },
    })).toEqual([{ type: 'assistant', content: 'Hello from ACP' }]);
  });

  it('maps execute tool calls to shell effects', () => {
    expect(mapACPSessionUpdate({
      sessionId: 'acp-session',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Run tests',
        kind: 'execute',
        status: 'pending',
        rawInput: { command: ' pnpm test ' },
      },
    })).toEqual([{
      type: 'tool_use',
      toolUseId: 'tool-1',
      toolName: 'Run tests',
      toolInput: { command: ' pnpm test ' },
      toolEffect: {
        kind: 'shell',
        command: 'pnpm test',
      },
    }]);
  });

  it('maps completed tool updates to tool results', () => {
    expect(mapACPSessionUpdate({
      sessionId: 'acp-session',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: 'done',
      },
    })).toEqual([{
      type: 'tool_result',
      toolUseId: 'tool-1',
      toolResult: 'done',
      isToolError: false,
    }]);
  });

  it('maps plan and mode updates to normalized semantics', () => {
    expect(mapACPSessionUpdate({
      update: {
        sessionUpdate: 'plan',
        toolCallId: 'plan-1',
        plan: '1. Inspect\n2. Patch',
      },
    })).toEqual([{
      type: 'tool_use',
      toolUseId: 'plan-1',
      toolName: 'ACPPlan',
      toolInput: { plan: '1. Inspect\n2. Patch' },
      toolSemantic: 'plan_proposal',
    }]);

    expect(mapACPSessionUpdate({
      update: {
        sessionUpdate: 'mode_update',
        toolCallId: 'mode-1',
        mode: 'plan',
      },
    })).toEqual([{
      type: 'mode_transition',
      modeTransition: {
        mode: 'plan',
        reason: 'enter',
        sourceToolUseId: 'mode-1',
      },
    }]);
  });

  it('maps prompt completion to result messages', () => {
    expect(mapACPPromptResult({ stopReason: 'end_turn' })).toEqual({
      type: 'result',
      content: 'end_turn',
      isComplete: true,
    });
  });
});
