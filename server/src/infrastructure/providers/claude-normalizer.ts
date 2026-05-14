import type {
  AskUserQuestionItem,
} from '@my-claudia/shared/interaction/forms';
import type {
  ProviderEventNormalizer,
  ProviderPermissionNormalization,
  ProviderPermissionRequestEvent,
  ProviderToolUseEvent,
  ProviderToolUseNormalization,
} from './provider-normalizer.js';
import { makeShellEffect } from './tool-effects.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export const CLAUDE_NORMALIZER: ProviderEventNormalizer = {
  normalizeToolUse(event: ProviderToolUseEvent): ProviderToolUseNormalization {
    const input = asRecord(event.toolInput);

    if (event.toolName === 'EnterPlanMode') {
      return {
        toolSemantic: 'plan_enter',
        modeTransition: {
          mode: 'plan',
          reason: 'enter',
          sourceToolUseId: event.toolUseId,
        },
      };
    }

    if (event.toolName === 'ExitPlanMode') {
      return {
        toolSemantic: 'plan_proposal',
        modeTransition: {
          mode: 'default',
          reason: 'exit',
          plan: typeof input?.plan === 'string' ? input.plan : undefined,
          sourceToolUseId: event.toolUseId,
        },
      };
    }

    if (event.toolName === 'Bash') {
      return {
        toolEffect: makeShellEffect(typeof input?.command === 'string' ? input.command : undefined),
      };
    }

    if (event.toolName === 'TodoWrite') {
      return {
        toolInteractionKind: 'todo_update',
      };
    }

    return {};
  },

  normalizePermissionRequest(event: ProviderPermissionRequestEvent): ProviderPermissionNormalization {
    if (event.toolName !== 'AskUserQuestion') {
      return {};
    }

    const input = asRecord(event.toolInput);
    return {
      interactionKind: 'ask_user_question',
      questions: Array.isArray(input?.questions) ? input.questions as AskUserQuestionItem[] : [],
    };
  },
};
