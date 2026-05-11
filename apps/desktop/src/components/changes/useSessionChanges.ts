import { useMemo } from 'react';
import { useChatStore, type MessageWithToolCalls, type ToolCallState } from '../../stores/chatStore';
import { extractMessageText } from '../../utils/messageContent';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

const BASH_PATTERNS: Array<{ kind: 'rm' | 'rmdir' | 'mv' | 'git'; re: RegExp; argIndex?: number }> = [
  { kind: 'rm', re: /^\s*rm(?:\s+-\S+)*\s+(.+?)\s*$/, argIndex: 1 },
  { kind: 'rmdir', re: /^\s*rmdir(?:\s+-\S+)*\s+(.+?)\s*$/, argIndex: 1 },
  { kind: 'mv', re: /^\s*mv(?:\s+-\S+)*\s+(\S+)\s+(\S+)\s*$/, argIndex: 2 },
  { kind: 'git', re: /^\s*git\s+(reset|restore|checkout)(\s+.*)?$/ },
];

export type EditFragment =
  | {
      kind: 'edit';
      oldText: string;
      newText: string;
      replaceAll: boolean;
      messageId: string;
      toolCallId: string;
      toolName: string;
      timestamp: number;
    }
  | {
      kind: 'write';
      content: string;
      messageId: string;
      toolCallId: string;
      toolName: string;
      timestamp: number;
    }
  | {
      kind: 'notebook';
      editMode: string;
      cellId?: string;
      newSource: string;
      messageId: string;
      toolCallId: string;
      toolName: string;
      timestamp: number;
    };

export interface FragmentGroup {
  sinceUserMessageId: string;
  sinceUserMessagePreview: string;
  sinceUserMessageTimestamp: number;
  fragments: EditFragment[];
}

export interface ModifiedEntry {
  path: string;
  absolutePath: string;
  toolCounts: Record<string, number>;
  groups: FragmentGroup[];
  lastTimestamp: number;
}

export interface AffectedEntry {
  path?: string;
  command: string;
  toolCallId: string;
  messageId: string;
  timestamp: number;
}

export interface SessionChangesResult {
  modified: ModifiedEntry[];
  affected: AffectedEntry[];
}

const USER_MESSAGE_PREVIEW_LEN = 60;

function userMessagePreview(content: string): string {
  const text = extractMessageText(content);
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > USER_MESSAGE_PREVIEW_LEN
    ? `${single.slice(0, USER_MESSAGE_PREVIEW_LEN - 1)}…`
    : single;
}

function normalizePath(absolutePath: string, projectRoot: string | undefined): string {
  if (!projectRoot) return absolutePath;
  const root = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot;
  if (absolutePath.startsWith(`${root}/`)) return absolutePath.slice(root.length + 1);
  if (absolutePath === root) return '.';
  return absolutePath;
}

interface BashDetection {
  kind: 'rm' | 'rmdir' | 'mv' | 'git';
  path?: string;
  command: string;
}

function detectDestructiveBash(rawCommand: string): BashDetection[] {
  // Split on top-level &&, ||, ; (does not respect quotes, good enough for heuristic)
  const segments = rawCommand.split(/\s*(?:&&|\|\||;)\s*/);
  const detections: BashDetection[] = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    for (const pattern of BASH_PATTERNS) {
      const m = trimmed.match(pattern.re);
      if (m) {
        let path: string | undefined;
        if (pattern.argIndex !== undefined) {
          const raw = m[pattern.argIndex]?.trim();
          if (raw) {
            // Take only the first whitespace-separated token if rm got multiple args
            path = raw.split(/\s+/)[0].replace(/^["']|["']$/g, '');
          }
        }
        detections.push({ kind: pattern.kind, path, command: trimmed });
        break;
      }
    }
  }
  return detections;
}

function getToolPath(toolName: string, toolInput: unknown): string | undefined {
  if (!toolInput || typeof toolInput !== 'object') return undefined;
  const input = toolInput as Record<string, unknown>;
  if (toolName === 'NotebookEdit') {
    return typeof input.notebook_path === 'string' ? input.notebook_path : undefined;
  }
  return typeof input.file_path === 'string' ? input.file_path : undefined;
}

function buildFragments(
  toolCall: ToolCallState,
  messageId: string,
  timestamp: number,
): EditFragment[] {
  const input = (toolCall.toolInput ?? {}) as Record<string, unknown>;
  const meta = {
    messageId,
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    timestamp,
  };
  if (toolCall.toolName === 'Edit') {
    return [{
      kind: 'edit',
      oldText: typeof input.old_string === 'string' ? input.old_string : '',
      newText: typeof input.new_string === 'string' ? input.new_string : '',
      replaceAll: input.replace_all === true,
      ...meta,
    }];
  }
  if (toolCall.toolName === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    return edits.map((e) => {
      const obj = (e ?? {}) as Record<string, unknown>;
      return {
        kind: 'edit' as const,
        oldText: typeof obj.old_string === 'string' ? obj.old_string : '',
        newText: typeof obj.new_string === 'string' ? obj.new_string : '',
        replaceAll: obj.replace_all === true,
        ...meta,
      };
    });
  }
  if (toolCall.toolName === 'Write') {
    return [{
      kind: 'write',
      content: typeof input.content === 'string' ? input.content : '',
      ...meta,
    }];
  }
  if (toolCall.toolName === 'NotebookEdit') {
    return [{
      kind: 'notebook',
      editMode: typeof input.edit_mode === 'string' ? input.edit_mode : 'replace',
      cellId: typeof input.cell_id === 'string' ? input.cell_id : undefined,
      newSource: typeof input.new_source === 'string' ? input.new_source : '',
      ...meta,
    }];
  }
  return [];
}

interface AggregateInput {
  messages: MessageWithToolCalls[];
  sinceMessageId: string | null;
  projectRoot: string | undefined;
}

/**
 * Pure aggregation — exposed for tests. Reads messages.toolCalls and emits
 * the grouped change set.
 */
export function aggregateSessionChanges({
  messages,
  sinceMessageId,
  projectRoot,
}: AggregateInput): SessionChangesResult {
  let startIdx = 0;
  if (sinceMessageId) {
    const idx = messages.findIndex((m) => m.id === sinceMessageId);
    if (idx >= 0) startIdx = idx;
  }

  let currentGroup: { id: string; preview: string; timestamp: number } | null = null;

  const modifiedMap = new Map<string, ModifiedEntry>();
  const affected: AffectedEntry[] = [];

  for (let i = startIdx; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'user') {
      currentGroup = {
        id: message.id,
        preview: userMessagePreview(message.content || ''),
        timestamp: message.createdAt,
      };
    }
    const toolCalls = message.toolCalls ?? [];
    if (toolCalls.length === 0) continue;
    if (!currentGroup) {
      // No user message yet — synthesize a placeholder group anchored at this assistant message
      currentGroup = {
        id: `__pre_${message.id}`,
        preview: '(before first user message)',
        timestamp: message.createdAt,
      };
    }

    for (const tc of toolCalls) {
      if (tc.status !== 'completed' || tc.isError) continue;

      if (WRITE_TOOLS.has(tc.toolName)) {
        const absolutePath = getToolPath(tc.toolName, tc.toolInput);
        if (!absolutePath) continue;
        const path = normalizePath(absolutePath, projectRoot);
        const fragments = buildFragments(tc, message.id, message.createdAt);
        if (fragments.length === 0) continue;

        let entry = modifiedMap.get(absolutePath);
        if (!entry) {
          entry = {
            path,
            absolutePath,
            toolCounts: {},
            groups: [],
            lastTimestamp: message.createdAt,
          };
          modifiedMap.set(absolutePath, entry);
        }
        entry.toolCounts[tc.toolName] = (entry.toolCounts[tc.toolName] ?? 0) + 1;
        entry.lastTimestamp = Math.max(entry.lastTimestamp, message.createdAt);

        const lastGroup = entry.groups[entry.groups.length - 1];
        if (lastGroup && lastGroup.sinceUserMessageId === currentGroup.id) {
          lastGroup.fragments.push(...fragments);
        } else {
          entry.groups.push({
            sinceUserMessageId: currentGroup.id,
            sinceUserMessagePreview: currentGroup.preview,
            sinceUserMessageTimestamp: currentGroup.timestamp,
            fragments: [...fragments],
          });
        }
        continue;
      }

      if (tc.toolName === 'Bash') {
        const input = (tc.toolInput ?? {}) as Record<string, unknown>;
        const cmd = typeof input.command === 'string' ? input.command : '';
        if (!cmd) continue;
        const detections = detectDestructiveBash(cmd);
        for (const det of detections) {
          affected.push({
            path: det.path ? normalizePath(det.path, projectRoot) : undefined,
            command: det.command,
            toolCallId: tc.id,
            messageId: message.id,
            timestamp: message.createdAt,
          });
        }
      }
    }
  }

  const modified = Array.from(modifiedMap.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  return { modified, affected };
}

export interface UserMessageOption {
  id: string;
  preview: string;
  timestamp: number;
}

/**
 * Combined hook for the Changes panel: subscribes to `messages[sessionId]`
 * once and derives (a) the aggregated changes and (b) the latest-user-message
 * id (used as the default "since" cursor when the user has not picked one).
 * One subscription = one React commit per chat update instead of two.
 *
 * `pickedSinceMessageId`:
 *   - `string` — explicit user-picked cursor (aggregate from here)
 *   - `null`   — user picked "Entire session" (aggregate from session start)
 *   - `undefined` — nothing picked; fall back to the latest user message
 */
export function useChangesData(
  sessionId: string | null | undefined,
  pickedSinceMessageId: string | null | undefined,
  projectRoot: string | undefined,
): {
  result: SessionChangesResult;
  latestUserMessageId: string | null;
  effectiveSinceId: string | null;
} {
  const messages = useChatStore((s) => (sessionId ? s.messages[sessionId] : undefined));
  return useMemo(() => {
    const msgs = messages ?? [];
    let latestUserMessageId: string | null = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { latestUserMessageId = msgs[i].id; break; }
    }
    const effectiveSinceId = pickedSinceMessageId !== undefined
      ? pickedSinceMessageId
      : latestUserMessageId;
    return {
      result: aggregateSessionChanges({
        messages: msgs,
        sinceMessageId: effectiveSinceId,
        projectRoot,
      }),
      latestUserMessageId,
      effectiveSinceId,
    };
  }, [messages, pickedSinceMessageId, projectRoot]);
}

/**
 * Builds the dropdown option list. Gated by `enabled` so the JSON-parse cost
 * (one per user message) is paid only while the selector is open — the
 * underlying chat subscription is bypassed entirely when `enabled` is false.
 */
export function useUserMessageOptions(
  sessionId: string | null | undefined,
  enabled: boolean,
): UserMessageOption[] {
  const messages = useChatStore((s) =>
    enabled && sessionId ? s.messages[sessionId] : undefined,
  );
  return useMemo(() => {
    if (!enabled || !messages) return [];
    const result: UserMessageOption[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'user') continue;
      result.push({
        id: m.id,
        preview: userMessagePreview(m.content || ''),
        timestamp: m.createdAt,
      });
    }
    return result;
  }, [enabled, messages]);
}
