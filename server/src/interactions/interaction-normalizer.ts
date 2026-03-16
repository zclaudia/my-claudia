/**
 * Interaction Normalizer
 *
 * Pure functions that convert raw provider events into unified
 * NormalizedInteractionEvents for the frontend.
 */

import type {
  AskUserInteractionMessage,
  AskUserQuestionItem,
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
  const name = args.toolName.toLowerCase();
  if (name !== 'todowrite' && name !== 'todo_write') {
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
// AskUserQuestion → interaction_ask_user
// ============================================

export interface NormalizeAskUserArgs {
  requestId: string;
  sessionId: string;
  runId?: string;
  providerType?: string;
  questions: AskUserQuestionItem[];
}

/**
 * Convert an AskUserQuestion event into an AskUserInteractionMessage.
 */
export function normalizeFromAskUser(args: NormalizeAskUserArgs): AskUserInteractionMessage {
  return {
    type: 'interaction_ask_user',
    interactionId: args.requestId,
    sessionId: args.sessionId,
    runId: args.runId,
    provider: args.providerType,
    source: 'provider_native',
    createdAt: Date.now(),
    questions: args.questions,
  };
}
