import { useMemo } from 'react';
import { useChatStore, type MessageWithToolCalls, type ToolCallState } from '../../stores/chatStore';
import { extractMessageText } from '../../utils/messageContent';

type WriteToolKind = 'edit' | 'write' | 'multiEdit' | 'notebook' | 'generic';

const TOOL_KIND_BY_NORMALIZED_NAME: Record<string, WriteToolKind> = {
  edit: 'edit',
  editfile: 'edit',
  updatefile: 'edit',
  replacefile: 'edit',
  multiedit: 'multiEdit',
  multiwrite: 'multiEdit',
  write: 'write',
  writefile: 'write',
  createfile: 'write',
  notebookedit: 'notebook',
  filechange: 'generic',
  applypatch: 'generic',
  patch: 'generic',
};

const PATH_INPUT_KEYS = [
  'file_path',
  'notebook_path',
  'path',
  'file',
  'filename',
  'target_file',
  'targetFile',
  'relative_path',
  'relativePath',
  'absolute_path',
  'absolutePath',
];

const BASH_TOOL_NAMES = new Set(['bash', 'shell', 'shelltoolcall', 'executecommand', 'commandexecution']);

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
    }
  | {
      kind: 'summary';
      summary: string;
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

export interface TurnStats {
  /** Distinct files modified in this turn (Edit/Write/MultiEdit/NotebookEdit). */
  fileCount: number;
  /** Number of individual edit operations (MultiEdit's `edits[]` are expanded). */
  editCount: number;
  /** Number of Write tool calls (i.e. fresh file writes). */
  writeCount: number;
  /** Number of NotebookEdit tool calls. */
  notebookEditCount: number;
  /** All Bash tool calls observed in this turn (not just destructive ones). */
  bashCount: number;
  /** Subset of bashCount that matched the destructive-command heuristic. */
  destructiveBashCount: number;
  /** Tool calls with `isError` set or status `error` — proxy for "things that broke". */
  failureCount: number;
  /** Open AskUserQuestion calls (status `running`) — proxy for "blocked on user". */
  pendingQuestionCount: number;
  /** Non-AskUserQuestion tool calls still running — proxy for "agent still working". */
  runningToolCount: number;
}

export interface TurnStat {
  userMessageId: string;
  userMessagePreview: string;
  timestamp: number;
  /** Id of the last message observed in this turn — used for summary
   *  staleness checks. May be the user message itself if no replies yet. */
  lastMessageId: string;
  stats: TurnStats;
}

/** Phrases an LLM may produce to mean "no open issues remain". Used to decide
 *  whether the "Create issue from Open" button should appear. */
const NO_OPEN_ISSUES_SENTINELS = new Set([
  '',
  '—',
  '-',
  '--',
  '无',
  '没有',
  '无遗留',
  'none',
  'nothing',
  'nothing remains',
  'no open issues',
  'no remaining issues',
  'n/a',
  'na',
]);

/** Returns true when the openIssues text describes an actual residual issue
 *  (as opposed to LLM filler like "—" / "none" / "无"). */
export function hasOpenIssues(openIssues: string): boolean {
  const normalised = openIssues
    .trim()
    .toLowerCase()
    .replace(/[.。!！]+$/g, '');
  return !NO_OPEN_ISSUES_SENTINELS.has(normalised);
}

/** Compose an issue title + description seeded from a turn summary. The first
 *  sentence of `openIssues` becomes the title (≤ 80 chars). The description
 *  embeds the open-issues text first (the user's main concern), followed by a
 *  small context footer so future-you knows which turn it came from. */
export function buildIssueFromSummary(args: {
  openIssues: string;
  goal: string;
  userMessagePreview: string;
  turnTimestamp: number;
}): { title: string; description: string } {
  const title = extractFirstSentence(args.openIssues, 80);
  const when = new Date(args.turnTimestamp).toLocaleString();
  const description = [
    args.openIssues.trim(),
    '',
    '---',
    '**Context**',
    `- Turn: "${args.userMessagePreview}" (${when})`,
    `- Goal: ${args.goal.trim()}`,
  ].join('\n');
  return { title, description };
}

function extractFirstSentence(text: string, maxLen: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  // First sentence terminator. CJK punctuation (`。!！?？`) always splits — no
  // trailing space is required since CJK text rarely uses one. The Western
  // period is gated on a following space so decimals ("v1.5") don't split.
  const match = collapsed.match(/^(.+?)(?:[。!！?？]|\.\s)/);
  const first = (match ? match[1] : collapsed).trim().replace(/[.。!！?？]+$/, '');
  return first.length > maxLen ? `${first.slice(0, maxLen - 1)}…` : first;
}

/** A turn is "empty" if nothing measurable happened — no files touched, no
 *  bash, no failures, no pending or running tool calls. Slash commands the
 *  user just typed but the agent hasn't acted on yet show up this way. */
export function isTurnEmpty(turn: TurnStat): boolean {
  const s = turn.stats;
  return s.fileCount === 0
    && s.editCount === 0
    && s.writeCount === 0
    && s.notebookEditCount === 0
    && s.bashCount === 0
    && s.failureCount === 0
    && s.pendingQuestionCount === 0
    && s.runningToolCount === 0;
}

export interface SessionChangesResult {
  modified: ModifiedEntry[];
  affected: AffectedEntry[];
  /** Per-turn stats, chronological (oldest first). */
  turns: TurnStat[];
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

function normalizeToolName(toolName: string): string {
  const lastSegment = toolName.includes(':') ? toolName.split(':').pop() ?? toolName : toolName;
  return lastSegment.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getWriteToolKind(toolName: string): WriteToolKind | null {
  return TOOL_KIND_BY_NORMALIZED_NAME[normalizeToolName(toolName)] ?? null;
}

function isBashTool(toolName: string): boolean {
  return BASH_TOOL_NAMES.has(normalizeToolName(toolName));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readStringField(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function hasAnyField(input: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => key in input);
}

function getToolPath(toolName: string, toolInput: unknown): string | undefined {
  const input = asRecord(toolInput);
  if (!input) return undefined;
  const keys = normalizeToolName(toolName) === 'notebookedit'
    ? ['notebook_path', ...PATH_INPUT_KEYS]
    : PATH_INPUT_KEYS;
  return readStringField(input, keys);
}

function cleanDiffPath(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined;
  let value = rawPath.trim();
  if (!value || value === '/dev/null') return undefined;
  value = value.replace(/^["']|["']$/g, '');
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2);
  const tabIdx = value.indexOf('\t');
  if (tabIdx >= 0) value = value.slice(0, tabIdx);
  return value || undefined;
}

function looksLikeFilePath(rawPath: string | undefined): boolean {
  const path = cleanDiffPath(rawPath);
  if (!path) return false;
  return path.startsWith('/')
    || path.startsWith('./')
    || path.startsWith('../')
    || path.includes('/')
    || /\.[A-Za-z0-9][A-Za-z0-9_-]{0,12}$/.test(path);
}

interface ParsedChangeSummary {
  absolutePath: string;
  summary: string;
}

function summarizeStructuredChange(change: unknown): string {
  if (typeof change === 'string') return change;
  const record = asRecord(change);
  if (!record) return '';
  const detail = readStringField(record, [
    'unified_diff',
    'unifiedDiff',
    'diff',
    'patch',
    'changes',
    'content',
    'summary',
    'description',
  ]);
  if (detail) return detail;
  const type = readStringField(record, ['type', 'status', 'kind']);
  return type ? `(${type})` : JSON.stringify(record);
}

function parseChangeObject(value: unknown): ParsedChangeSummary[] {
  const record = asRecord(value);
  if (!record) return [];

  const entries: ParsedChangeSummary[] = [];
  for (const [rawPath, change] of Object.entries(record)) {
    const path = cleanDiffPath(rawPath);
    if (!path) continue;
    entries.push({
      absolutePath: path,
      summary: summarizeStructuredChange(change),
    });
  }
  return entries;
}

function parseChangeArray(value: unknown): ParsedChangeSummary[] {
  if (!Array.isArray(value)) return [];
  const entries: ParsedChangeSummary[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const path = cleanDiffPath(readStringField(record, PATH_INPUT_KEYS));
    if (!path) continue;
    entries.push({
      absolutePath: path,
      summary: summarizeStructuredChange(record),
    });
  }
  return entries;
}

function parseChangeSummaryText(text: string): ParsedChangeSummary[] {
  const lines = text.split(/\r?\n/);
  const byPath = new Map<string, string[]>();
  let currentPath: string | undefined;

  const setCurrentPath = (rawPath: string | undefined) => {
    const path = cleanDiffPath(rawPath);
    if (!path) return;
    currentPath = path;
    if (!byPath.has(path)) byPath.set(path, []);
  };

  for (const line of lines) {
    const gitDiff = line.match(/^diff --git\s+(?:"?a\/(.+?)"?\s+)?(?:"?b\/(.+?)"?)\s*$/);
    if (gitDiff) {
      setCurrentPath(gitDiff[2] ?? gitDiff[1]);
    }

    const plusPath = line.match(/^\+\+\+\s+(.+)$/);
    if (plusPath) {
      setCurrentPath(plusPath[1]);
    }

    const patchPath = line.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/);
    if (patchPath) {
      setCurrentPath(patchPath[1]);
    }

    const headerPath = line.match(/^([^:\n]+):(?:\s+\((?:new file|deleted|modified|updated|renamed)\))?\s*$/i);
    if (headerPath
      && !line.startsWith('+')
      && !line.startsWith('-')
      && !line.startsWith('@')
      && looksLikeFilePath(headerPath[1])) {
      setCurrentPath(headerPath[1]);
    }

    if (currentPath) {
      byPath.get(currentPath)?.push(line);
    }
  }

  return Array.from(byPath.entries()).map(([absolutePath, summaryLines]) => ({
    absolutePath,
    summary: summaryLines.join('\n').trim() || text,
  }));
}

function parseChangeSummaries(toolInput: unknown): ParsedChangeSummary[] {
  const input = asRecord(toolInput);
  if (!input) return [];

  const structuredCandidates = [
    input.fileChanges,
    input.file_changes,
    input.files,
    input.changedFiles,
    input.changed_files,
  ];
  for (const candidate of structuredCandidates) {
    const parsed = parseChangeObject(candidate);
    if (parsed.length > 0) return parsed;
    const arrayParsed = parseChangeArray(candidate);
    if (arrayParsed.length > 0) return arrayParsed;
  }

  const changes = input.changes;
  const parsedChangesObject = parseChangeObject(changes);
  if (parsedChangesObject.length > 0) return parsedChangesObject;
  const parsedChangesArray = parseChangeArray(changes);
  if (parsedChangesArray.length > 0) return parsedChangesArray;
  if (typeof changes === 'string' && changes.trim()) {
    return parseChangeSummaryText(changes);
  }

  const diff = readStringField(input, ['unified_diff', 'unifiedDiff', 'diff', 'patch']);
  if (diff) return parseChangeSummaryText(diff);

  return [];
}

function buildSummaryFragment(
  toolCall: ToolCallState,
  messageId: string,
  timestamp: number,
  summary: string,
): EditFragment {
  return {
    kind: 'summary',
    summary: summary.trim() || `${toolCall.toolName} changed this file`,
    messageId,
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    timestamp,
  };
}

function buildFragments(
  toolCall: ToolCallState,
  messageId: string,
  timestamp: number,
  kind: WriteToolKind,
  summary?: string,
): EditFragment[] {
  const input = asRecord(toolCall.toolInput) ?? {};
  const meta = {
    messageId,
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    timestamp,
  };
  if (summary) return [buildSummaryFragment(toolCall, messageId, timestamp, summary)];
  const providerSummary = readStringField(input, ['summary', 'changes', 'diff', 'patch', 'unified_diff', 'unifiedDiff']);

  if (kind === 'edit') {
    const oldKeys = ['old_string', 'oldString', 'old_text', 'oldText', 'old', 'before'];
    const newKeys = ['new_string', 'newString', 'new_text', 'newText', 'new', 'after', 'replacement', 'content', 'text'];
    if (!hasAnyField(input, [...oldKeys, ...newKeys])) {
      return [buildSummaryFragment(toolCall, messageId, timestamp, providerSummary ?? '')];
    }
    return [{
      kind: 'edit',
      oldText: readStringField(input, oldKeys) ?? '',
      newText: readStringField(input, newKeys) ?? '',
      replaceAll: input.replace_all === true,
      ...meta,
    }];
  }
  if (kind === 'multiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    if (edits.length === 0) {
      return [buildSummaryFragment(toolCall, messageId, timestamp, providerSummary ?? '')];
    }
    return edits.map((e) => {
      const obj = (e ?? {}) as Record<string, unknown>;
      return {
        kind: 'edit' as const,
        oldText: readStringField(obj, ['old_string', 'oldString', 'old_text', 'oldText', 'old', 'before']) ?? '',
        newText: readStringField(obj, ['new_string', 'newString', 'new_text', 'newText', 'new', 'after', 'replacement']) ?? '',
        replaceAll: obj.replace_all === true,
        ...meta,
      };
    });
  }
  if (kind === 'write') {
    const content = readStringField(input, ['content', 'text', 'new_content', 'newContent', 'source', 'value']);
    if (content === undefined) {
      return [buildSummaryFragment(toolCall, messageId, timestamp, providerSummary ?? '')];
    }
    return [{
      kind: 'write',
      content,
      ...meta,
    }];
  }
  if (kind === 'notebook') {
    return [{
      kind: 'notebook',
      editMode: typeof input.edit_mode === 'string' ? input.edit_mode : 'replace',
      cellId: typeof input.cell_id === 'string' ? input.cell_id : undefined,
      newSource: typeof input.new_source === 'string' ? input.new_source : '',
      ...meta,
    }];
  }
  return [buildSummaryFragment(toolCall, messageId, timestamp, providerSummary ?? '')];
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
  // Per-turn stat accumulators; `files` tracks distinct file paths so we can
  // emit fileCount at the end without double-counting across tool calls.
  const turnStatsMap = new Map<string, {
    userMessageId: string;
    userMessagePreview: string;
    timestamp: number;
    lastMessageId: string;
    files: Set<string>;
    stats: TurnStats;
  }>();

  const emptyStats = (): TurnStats => ({
    fileCount: 0,
    editCount: 0,
    writeCount: 0,
    notebookEditCount: 0,
    bashCount: 0,
    destructiveBashCount: 0,
    failureCount: 0,
    pendingQuestionCount: 0,
    runningToolCount: 0,
  });

  const ensureTurn = (group: { id: string; preview: string; timestamp: number }) => {
    let turn = turnStatsMap.get(group.id);
    if (!turn) {
      turn = {
        userMessageId: group.id,
        userMessagePreview: group.preview,
        timestamp: group.timestamp,
        lastMessageId: group.id,
        files: new Set<string>(),
        stats: emptyStats(),
      };
      turnStatsMap.set(group.id, turn);
    }
    return turn;
  };

  for (let i = startIdx; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'user') {
      currentGroup = {
        id: message.id,
        preview: userMessagePreview(message.content || ''),
        timestamp: message.createdAt,
      };
      // Materialize the turn even if it has no tool calls yet — gives the
      // panel something to render the moment the user sends a message.
      ensureTurn(currentGroup);
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
    const turn = ensureTurn(currentGroup);
    turn.lastMessageId = message.id;

    for (const tc of toolCalls) {
      // ── Stats accounting (runs for ALL tool calls, including failures) ──
      const isFailed = tc.isError === true || tc.status === 'error';
      if (isFailed) {
        turn.stats.failureCount += 1;
      } else if (tc.status === 'running') {
        if (tc.toolName === 'AskUserQuestion') turn.stats.pendingQuestionCount += 1;
        else turn.stats.runningToolCount += 1;
      }
      if (isBashTool(tc.toolName)) turn.stats.bashCount += 1;

      // ── Modified files / affected entries (only for successful calls) ──
      if (tc.status !== 'completed' || tc.isError) continue;

      const writeToolKind = getWriteToolKind(tc.toolName);
      if (writeToolKind) {
        const directPath = cleanDiffPath(getToolPath(tc.toolName, tc.toolInput));
        const parsedSummaries = directPath ? [] : parseChangeSummaries(tc.toolInput);
        const changeTargets = directPath
          ? [{ absolutePath: directPath, summary: undefined as string | undefined }]
          : parsedSummaries.map((item) => ({ absolutePath: item.absolutePath, summary: item.summary }));

        for (const target of changeTargets) {
          const fragments = buildFragments(tc, message.id, message.createdAt, writeToolKind, target.summary);
          if (fragments.length === 0) continue;

          const absolutePath = target.absolutePath;
          const path = normalizePath(absolutePath, projectRoot);
          turn.files.add(absolutePath);
          if (writeToolKind === 'write') turn.stats.writeCount += 1;
          else if (writeToolKind === 'notebook') turn.stats.notebookEditCount += 1;
          else turn.stats.editCount += fragments.length;

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
        }
        continue;
      }

      if (isBashTool(tc.toolName)) {
        const input = asRecord(tc.toolInput) ?? {};
        const cmd = readStringField(input, ['command', 'cmd', 'script']) ?? '';
        if (!cmd) continue;
        const detections = detectDestructiveBash(cmd);
        turn.stats.destructiveBashCount += detections.length;
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
  const turns: TurnStat[] = Array.from(turnStatsMap.values())
    .map((t) => ({
      userMessageId: t.userMessageId,
      userMessagePreview: t.userMessagePreview,
      timestamp: t.timestamp,
      lastMessageId: t.lastMessageId,
      stats: { ...t.stats, fileCount: t.files.size },
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
  return { modified, affected, turns };
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
  /** The picked-or-latest user message rendered as a dropdown option — kept on
   *  this hook so the SinceSelector button label doesn't depend on the
   *  options-list hook (which is gated behind the dropdown being open). */
  effectiveSinceOption: UserMessageOption | null;
} {
  const messages = useChatStore((s) => (sessionId ? s.messages[sessionId] : undefined));
  return useMemo(() => {
    const msgs = messages ?? [];
    let latestUserMessageId: string | null = null;
    let latestUserMessage: MessageWithToolCalls | null = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        latestUserMessageId = msgs[i].id;
        latestUserMessage = msgs[i];
        break;
      }
    }
    const effectiveSinceId = pickedSinceMessageId !== undefined
      ? pickedSinceMessageId
      : latestUserMessageId;

    let effectiveSinceOption: UserMessageOption | null = null;
    if (effectiveSinceId) {
      const target = effectiveSinceId === latestUserMessageId
        ? latestUserMessage
        : msgs.find((m) => m.id === effectiveSinceId && m.role === 'user') ?? null;
      if (target) {
        effectiveSinceOption = {
          id: target.id,
          preview: userMessagePreview(target.content || ''),
          timestamp: target.createdAt,
        };
      }
    }

    return {
      result: aggregateSessionChanges({
        messages: msgs,
        sinceMessageId: effectiveSinceId,
        projectRoot,
      }),
      latestUserMessageId,
      effectiveSinceId,
      effectiveSinceOption,
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
