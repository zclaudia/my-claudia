/**
 * Interaction Normalizer
 *
 * Pure functions that convert raw provider events into unified
 * NormalizedInteractionEvents for the frontend.
 */

import type {
  AskUserQuestionItem,
  InteractionPromptMessage,
  TodoUpdateInteractionMessage,
} from '@my-claudia/shared';
import { normalizeTodoItems } from './todo-normalizer.js';

// ============================================
// TodoWrite → interaction_todo_update
// ============================================

export interface NormalizeToolUseArgs {
  sessionId: string;
  runId?: string;
  providerType?: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
}

/**
 * If the tool_use is a TodoWrite, normalize it into a TodoUpdateInteractionMessage.
 * Returns null for all other tools.
 */
export function normalizeFromToolUse(args: NormalizeToolUseArgs): TodoUpdateInteractionMessage | null {
  const name = args.toolName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (name !== 'todowrite' && name !== 'updatetodos' && name !== 'todolist' && name !== 'todolistwrite') {
    return null;
  }

  if (!args.toolUseId) {
    return null;
  }

  const todos = normalizeTodoItems(args.toolInput);
  if (todos.length === 0) {
    return null;
  }

  return {
    type: 'interaction_todo_update',
    interactionId: args.toolUseId,
    sessionId: args.sessionId,
    runId: args.runId,
    provider: args.providerType,
    source: 'tool_call',
    createdAt: Date.now(),
    todos,
  };
}

// ============================================
// AskUserQuestion → interaction_prompt
// ============================================

export interface NormalizeAskUserArgs {
  requestId: string;
  sessionId: string;
  runId?: string;
  providerType?: string;
  questions: AskUserQuestionItem[];
}

/**
 * Convert an AskUserQuestion event into a unified prompt interaction.
 */
export function normalizeFromAskUser(args: NormalizeAskUserArgs): InteractionPromptMessage {
  return {
    type: 'interaction_prompt',
    interactionId: args.requestId,
    sessionId: args.sessionId,
    runId: args.runId,
    provider: args.providerType,
    source: 'provider_native',
    createdAt: Date.now(),
    title: args.questions.length > 1 ? 'Questions' : 'Question',
    fields: args.questions.map((question, index) => ({
      id: `question_${index}`,
      label: question.question,
      description: question.header,
      type: question.multiSelect ? 'multiselect' : 'select',
      options: question.options.map((option) => ({
        value: option.label,
        label: option.label,
        description: option.description,
      })),
      allowCustomValue: true,
      customValuePlaceholder: 'Other',
    })),
    submitLabel: 'Submit',
    cancelLabel: 'Skip',
    responseMode: 'prompt_answer',
    variant: 'question',
  };
}
