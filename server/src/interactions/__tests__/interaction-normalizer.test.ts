import { describe, expect, it } from 'vitest';
import { normalizeFromToolUse } from '../interaction-normalizer.js';

describe('normalizeFromToolUse', () => {
  it('returns normalized todo interaction for valid TodoWrite input', () => {
    const result = normalizeFromToolUse({
      sessionId: 'session-1',
      runId: 'run-1',
      providerType: 'claude',
      toolUseId: 'tool-1',
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          { content: 'Fix bug', status: 'completed' },
          { content: 'Ship patch', status: 'in_progress' },
        ],
      },
    });

    expect(result).toMatchObject({
      type: 'interaction_todo_update',
      interactionId: 'tool-1',
      sessionId: 'session-1',
      runId: 'run-1',
      provider: 'claude',
      todos: [
        { content: 'Fix bug', status: 'completed' },
        { content: 'Ship patch', status: 'in_progress' },
      ],
    });
  });

  it('returns null when TodoWrite payload cannot be normalized', () => {
    const result = normalizeFromToolUse({
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      toolName: 'TodoWrite',
      toolInput: { unexpected: 'shape' },
    });

    expect(result).toBeNull();
  });

  it('returns null when toolUseId is missing', () => {
    const result = normalizeFromToolUse({
      sessionId: 'session-1',
      toolUseId: '',
      toolName: 'TodoWrite',
      toolInput: { todos: [{ content: 'Task', status: 'pending' }] },
    });

    expect(result).toBeNull();
  });
});
