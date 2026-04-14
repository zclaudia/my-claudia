import { describe, expect, it, vi } from 'vitest';
import { CliInteractiveBridge } from '../cli-interactive-bridge.js';
import { SUBMIT_STRUCTURED_RESULT_TOOL_NAME } from '../../structured-result/finalization-tool.js';
import type { ProviderBridgeRequest, ToolCall } from '../types.js';

function createRequest(overrides: Partial<ProviderBridgeRequest> = {}): ProviderBridgeRequest {
  return {
    prompt: 'Review this tool call',
    cwd: '/workspace',
    systemPrompt: 'system prompt',
    finalTool: {
      name: SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
      description: 'submit result',
      inputSchema: {
        type: 'object',
        properties: {
          result_type: { type: 'string' },
          payload: {
            type: 'object',
            properties: {
              decision: { type: 'string' },
              reasoning: { type: 'string' },
              confidence: { type: 'number' },
            },
          },
        },
      },
    },
    ...overrides,
  };
}

describe('CliInteractiveBridge', () => {
  it('submits structured result through onToolCall and returns immediately after finalization', async () => {
    const runPrompt = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        result_type: 'ai_review_v1',
        payload: { decision: 'approve', reasoning: 'safe', confidence: 0.95 },
      }),
      sessionId: 'session-1',
    });
    const onToolCall = vi.fn().mockResolvedValue({
      finalized: true,
      toolResult: { isError: false, content: 'ok' },
    });

    const bridge = new CliInteractiveBridge({
      providerType: 'claude',
      promptProvider: { runPrompt },
    });

    const result = await bridge.run(createRequest({ onToolCall }));

    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith({
      name: SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
      arguments: {
        result_type: 'ai_review_v1',
        payload: { decision: 'approve', reasoning: 'safe', confidence: 0.95 },
      },
    });
    expect(result.rawText).toContain('"result_type":"ai_review_v1"');
    expect(result.timedOut).toBeUndefined();
  });

  it('re-prompts with validation feedback and reuses session when structured result is rejected once', async () => {
    const runPrompt = vi
      .fn()
      .mockResolvedValueOnce({
        response: JSON.stringify({
          result_type: 'ai_review_v1',
          payload: { decision: 'approve', reasoning: '', confidence: 2 },
        }),
        sessionId: 'session-2',
      })
      .mockResolvedValueOnce({
        response: JSON.stringify({
          result_type: 'ai_review_v1',
          payload: { decision: 'deny', reasoning: 'dangerous', confidence: 0.8 },
        }),
        sessionId: 'session-2',
      });
    const onToolCall = vi
      .fn()
      .mockResolvedValueOnce({
        finalized: false,
        toolResult: { isError: true, content: 'confidence must be between 0 and 1' },
      })
      .mockResolvedValueOnce({
        finalized: true,
        toolResult: { isError: false, content: 'accepted' },
      });

    const bridge = new CliInteractiveBridge({
      providerType: 'claude',
      promptProvider: { runPrompt },
    });

    const result = await bridge.run(createRequest({ onToolCall }));

    expect(runPrompt).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('confidence must be between 0 and 1'),
      'session-2',
    );
    expect(onToolCall).toHaveBeenCalledTimes(2);
    expect(result.rawText).toContain('"decision":"deny"');
  });

  it('handles read_file tool calls through toolHandler before returning final text', async () => {
    const runPrompt = vi
      .fn()
      .mockResolvedValueOnce({
        response: JSON.stringify({
          type: 'read_file',
          path: 'scripts/deploy.sh',
          reason: 'inspect deployment script',
        }),
        sessionId: 'session-3',
      })
      .mockResolvedValueOnce({
        response: 'final answer without structured result',
        sessionId: 'session-3',
      });
    const toolHandler = vi.fn(async (call: ToolCall) => {
      expect(call).toEqual({
        name: 'read_file',
        arguments: {
          type: 'read_file',
          path: 'scripts/deploy.sh',
          reason: 'inspect deployment script',
        },
      });
      return {
        nextPrompt: '<file_content path="scripts/deploy.sh">echo deploy</file_content>',
      };
    });

    const bridge = new CliInteractiveBridge({
      providerType: 'claude',
      promptProvider: { runPrompt },
      toolHandler,
    });

    const result = await bridge.run(createRequest());

    expect(toolHandler).toHaveBeenCalledTimes(1);
    expect(runPrompt).toHaveBeenNthCalledWith(
      2,
      '<file_content path="scripts/deploy.sh">echo deploy</file_content>',
      'session-3',
    );
    expect(result).toMatchObject({
      rawText: 'final answer without structured result',
    });
  });
});
