import { describe, expect, it } from 'vitest';
import { CLAUDE_NORMALIZER } from '../claude-normalizer.js';

describe('CLAUDE_NORMALIZER', () => {
  it('normalizes EnterPlanMode into plan enter semantics', () => {
    const result = CLAUDE_NORMALIZER.normalizeToolUse?.({
      toolUseId: 'tool-enter',
      toolName: 'EnterPlanMode',
      toolInput: {},
    });

    expect(result).toEqual({
      toolSemantic: 'plan_enter',
      modeTransition: {
        mode: 'plan',
        reason: 'enter',
        sourceToolUseId: 'tool-enter',
      },
    });
  });

  it('normalizes ExitPlanMode into plan proposal semantics', () => {
    const result = CLAUDE_NORMALIZER.normalizeToolUse?.({
      toolUseId: 'tool-exit',
      toolName: 'ExitPlanMode',
      toolInput: { plan: '1. Update code\n2. Run tests' },
    });

    expect(result).toEqual({
      toolSemantic: 'plan_proposal',
      modeTransition: {
        mode: 'default',
        reason: 'exit',
        plan: '1. Update code\n2. Run tests',
        sourceToolUseId: 'tool-exit',
      },
    });
  });

  it('normalizes Bash into a shell effect', () => {
    const result = CLAUDE_NORMALIZER.normalizeToolUse?.({
      toolUseId: 'tool-bash',
      toolName: 'Bash',
      toolInput: { command: ' pnpm test ' },
    });

    expect(result).toEqual({
      toolEffect: {
        kind: 'shell',
        command: 'pnpm test',
      },
    });
  });

  it('normalizes TodoWrite into a todo interaction kind', () => {
    const result = CLAUDE_NORMALIZER.normalizeToolUse?.({
      toolUseId: 'tool-todo',
      toolName: 'TodoWrite',
      toolInput: {
        todos: [{ content: 'Ship patch', status: 'pending' }],
      },
    });

    expect(result).toEqual({
      toolInteractionKind: 'todo_update',
    });
  });

  it('normalizes AskUserQuestion permission requests into prompt interactions', () => {
    const questions = [{
      question: 'Proceed?',
      options: [{ label: 'Yes' }, { label: 'No' }],
    }];

    const result = CLAUDE_NORMALIZER.normalizePermissionRequest?.({
      requestId: 'req-1',
      toolName: 'AskUserQuestion',
      toolInput: { questions },
    });

    expect(result).toEqual({
      interactionKind: 'ask_user_question',
      questions,
    });
  });

  it('does not add metadata for ordinary tools', () => {
    const result = CLAUDE_NORMALIZER.normalizeToolUse?.({
      toolUseId: 'tool-read',
      toolName: 'Read',
      toolInput: { file_path: 'server/src/index.ts' },
    });

    expect(result).toEqual({});
  });
});
