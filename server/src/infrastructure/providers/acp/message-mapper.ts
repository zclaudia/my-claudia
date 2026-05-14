import type { ToolEffect } from '@my-claudia/shared/core/message';
import type { ClaudeMessage } from '../message-types.js';
import {
  fileChangeEffectFromArray,
  makeFileChangeEffect,
  makeShellEffect,
} from '../tool-effects.js';
import type {
  ACPContentBlock,
  ACPPromptResult,
  ACPSessionUpdate,
  ACPSessionUpdateParams,
  ACPToolCall,
  ACPToolCallContent,
} from './types.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  const record = asRecord(content) as ACPContentBlock | undefined;
  if (!record) return undefined;
  if (typeof record.text === 'string') return record.text;
  return undefined;
}

function extractToolContent(update: ACPSessionUpdate): ACPToolCallContent[] {
  const candidates = [
    update.content,
    update.contentBlocks,
    update.contentItems,
    update.contentParts,
    update.contentList,
    update.contentUpdates,
    update.contentUpdate,
    update.contentDelta,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as ACPToolCallContent[];
    }
  }

  return [];
}

function toolEffectFromKind(kind: string | undefined, input: unknown, content: ACPToolCallContent[]): ToolEffect | undefined {
  if (kind === 'execute') {
    const record = asRecord(input);
    return makeShellEffect(
      typeof record?.command === 'string'
        ? record.command
        : typeof record?.cmd === 'string'
          ? record.cmd
          : undefined,
    );
  }

  if (kind === 'edit' || kind === 'delete' || kind === 'move') {
    const diffFiles = content
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => !!item && item.type === 'diff' && typeof item.path === 'string')
      .map((item) => ({
        path: item.path as string,
        changeKind: kind === 'delete' ? 'delete' as const : kind === 'move' ? 'rename' as const : 'modify' as const,
        summary: typeof item.newText === 'string' ? item.newText : undefined,
      }));

    if (diffFiles.length > 0) {
      return makeFileChangeEffect(diffFiles);
    }

    return fileChangeEffectFromArray(Array.isArray(input) ? input : [input]);
  }

  return undefined;
}

function toolResultFromContent(content: ACPToolCallContent[], rawOutput: unknown): unknown {
  if (rawOutput !== undefined) return rawOutput;

  const text = content
    .map((item) => {
      const record = asRecord(item);
      if (!record) return undefined;
      if (record.type === 'content') return textFromContent(record.content);
      if (record.type === 'terminal') return `Terminal: ${record.terminalId ?? ''}`.trim();
      return undefined;
    })
    .filter((part): part is string => !!part)
    .join('\n');

  return text || undefined;
}

function toolCallFromUpdate(update: ACPSessionUpdate): ACPToolCall {
  return {
    toolCallId: update.toolCallId,
    title: update.title,
    kind: update.kind,
    status: update.status,
    rawInput: update.rawInput,
    rawOutput: update.rawOutput,
    content: extractToolContent(update),
    locations: update.locations,
  };
}

export function mapACPSessionUpdate(params: ACPSessionUpdateParams): ClaudeMessage[] {
  const update = params.update;
  if (!update) return [];

  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'assistant_message_chunk': {
      const content = textFromContent(update.content);
      return content ? [{ type: 'assistant', content }] : [];
    }

    case 'user_message_chunk':
      return [];

    case 'tool_call': {
      const tool = toolCallFromUpdate(update);
      return [{
        type: 'tool_use',
        toolUseId: tool.toolCallId,
        toolName: tool.title ?? tool.kind ?? 'ACP Tool',
        toolInput: tool.rawInput,
        toolEffect: toolEffectFromKind(tool.kind, tool.rawInput, tool.content ?? []),
      }];
    }

    case 'tool_call_update': {
      const tool = toolCallFromUpdate(update);
      if (tool.status === 'completed' || tool.status === 'failed') {
        return [{
          type: 'tool_result',
          toolUseId: tool.toolCallId,
          toolResult: toolResultFromContent(tool.content ?? [], tool.rawOutput),
          isToolError: tool.status === 'failed',
        }];
      }

      return [];
    }

    case 'plan':
    case 'agent_plan': {
      const plan = typeof update.plan === 'string' ? update.plan : textFromContent(update.content);
      return [{
        type: 'tool_use',
        toolUseId: update.toolCallId,
        toolName: 'ACPPlan',
        toolInput: { plan },
        toolSemantic: 'plan_proposal',
      }];
    }

    case 'mode_update':
    case 'mode_change': {
      if (typeof update.mode !== 'string') return [];
      return [{
        type: 'mode_transition',
        modeTransition: {
          mode: update.mode,
          reason: update.mode === 'plan' ? 'enter' : 'exit',
          sourceToolUseId: update.toolCallId,
        },
      }];
    }

    default:
      return [];
  }
}

export function mapACPPromptResult(result: ACPPromptResult | undefined): ClaudeMessage {
  return {
    type: 'result',
    content: result?.stopReason,
    isComplete: true,
  };
}
