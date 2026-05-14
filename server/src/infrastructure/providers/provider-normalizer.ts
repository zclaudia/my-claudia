import type { ToolEffect } from '@my-claudia/shared/core/message';
import type { AskUserQuestionItem } from '@my-claudia/shared/interaction/forms';
import type { ToolSemantic } from '@my-claudia/shared/protocol/messages/run';
import type { ModeTransition, ToolInteractionKind } from './message-types.js';

export interface ProviderToolUseEvent {
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
}

export interface ProviderToolUseNormalization {
  toolSemantic?: ToolSemantic;
  toolEffect?: ToolEffect;
  toolInteractionKind?: ToolInteractionKind;
  modeTransition?: ModeTransition;
}

export interface ProviderPermissionRequestEvent {
  requestId?: string;
  toolName?: string;
  toolInput?: unknown;
}

export interface ProviderPermissionNormalization {
  interactionKind?: 'ask_user_question';
  questions?: AskUserQuestionItem[];
}

export interface ProviderEventNormalizer {
  normalizeToolUse?(event: ProviderToolUseEvent): ProviderToolUseNormalization;
  normalizePermissionRequest?(event: ProviderPermissionRequestEvent): ProviderPermissionNormalization;
}
