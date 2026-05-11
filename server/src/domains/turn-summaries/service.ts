import os from 'os';
import type { Database } from 'better-sqlite3';
import type { TurnSummary } from '@my-claudia/shared/features/turn-summary';
import type { MessageRole } from '@my-claudia/shared/core/message';
import { runCliJob } from '../../infrastructure/providers/cli-jobs/runner.js';
import { claudeReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/claude.js';
import { extractJSONObjects } from '../../infrastructure/providers/cli-jobs/json-extract.js';
import { TurnSummaryRepository } from './repository.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const TOOL_INPUT_PREVIEW_CHARS = 200;
const SYSTEM_PROMPT =
  'You are summarising one turn of an AI coding assistant conversation. ' +
  'You MUST respond with ONLY a single JSON object on one line and nothing else. ' +
  'Match the language of the user message.';

interface TurnMessage {
  id: string;
  role: MessageRole;
  content: string;
  metadata: string | null;
  offset: number;
  createdAt: number;
}

interface SessionContext {
  workingDirectory: string | null;
}

export class TurnSummaryService {
  private repo: TurnSummaryRepository;

  constructor(private db: Database) {
    this.repo = new TurnSummaryRepository(db);
  }

  getRepo(): TurnSummaryRepository {
    return this.repo;
  }

  listForSession(sessionId: string): TurnSummary[] {
    return this.repo.listBySession(sessionId);
  }

  async generate(
    sessionId: string,
    userMessageId: string,
    options: { model?: string; force?: boolean } = {},
  ): Promise<{ summary: TurnSummary; fromCache: boolean }> {
    const turnMessages = this.loadTurnMessages(sessionId, userMessageId);
    if (turnMessages.length === 0) {
      throw new Error(`No messages found for turn ${userMessageId}`);
    }
    const userMessage = turnMessages[0];
    if (userMessage.role !== 'user') {
      throw new Error(`Message ${userMessageId} is not a user message`);
    }
    const asOfMessageId = turnMessages[turnMessages.length - 1].id;

    if (!options.force) {
      const cached = this.repo.findByTurn(sessionId, userMessageId);
      if (cached && cached.asOfMessageId === asOfMessageId) {
        return { summary: cached, fromCache: true };
      }
    }

    const session = this.loadSessionContext(sessionId);
    const prompt = buildSummaryPrompt(turnMessages);
    const cwd = session.workingDirectory && session.workingDirectory.length > 0
      ? session.workingDirectory
      : os.tmpdir();

    const assistantText = await runCliJob(
      claudeReviewAdapter,
      {
        prompt,
        cwd,
        model: options.model,
        systemPrompt: SYSTEM_PROMPT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
      (text) => text,
    );

    const parsed = parseSummaryResponse(assistantText);
    const summary: TurnSummary = {
      sessionId,
      userMessageId,
      asOfMessageId,
      goal: parsed.goal,
      solved: parsed.solved,
      openIssues: parsed.openIssues,
      model: options.model ?? 'claude-default',
      generatedAt: Date.now(),
    };
    this.repo.upsert(summary);
    return { summary, fromCache: false };
  }

  // ── internals ──────────────────────────────────────────────────────────

  private loadTurnMessages(sessionId: string, userMessageId: string): TurnMessage[] {
    const start = this.db
      .prepare<[string, string], { offset: number }>(
        'SELECT offset FROM messages WHERE session_id = ? AND id = ?',
      )
      .get(sessionId, userMessageId);
    if (!start) return [];

    const next = this.db
      .prepare<[string, number], { offset: number }>(
        `SELECT offset FROM messages
         WHERE session_id = ? AND role = 'user' AND offset > ?
         ORDER BY offset ASC LIMIT 1`,
      )
      .get(sessionId, start.offset);

    const upperOffset = next ? next.offset : Number.MAX_SAFE_INTEGER;

    const rows = this.db
      .prepare<[string, number, number], TurnMessage>(
        `SELECT id, role, content, metadata, offset, created_at as createdAt
         FROM messages
         WHERE session_id = ? AND offset >= ? AND offset < ?
         ORDER BY offset ASC`,
      )
      .all(sessionId, start.offset, upperOffset);
    return rows;
  }

  private loadSessionContext(sessionId: string): SessionContext {
    const row = this.db
      .prepare<[string], { working_directory: string | null }>(
        'SELECT working_directory FROM sessions WHERE id = ?',
      )
      .get(sessionId);
    return { workingDirectory: row?.working_directory ?? null };
  }
}

// ── prompt + parsing helpers (exported for tests) ────────────────────────

interface ParsedSummary {
  goal: string;
  solved: string;
  openIssues: string;
}

export function buildSummaryPrompt(messages: TurnMessage[]): string {
  const lines: string[] = [
    'Read the following turn of an AI coding conversation and return a JSON summary.',
    '',
    'Return ONLY this JSON object on one line, no prose before or after:',
    '{"goal": "...", "solved": "...", "openIssues": "..."}',
    '',
    'Rules:',
    '- goal: 1-2 sentences — what the user asked for.',
    '- solved: 2-3 sentences — the net outcome (not a step-by-step list).',
    '- openIssues: 1-2 sentences — what remains unresolved, failed, or pending. Use "—" if nothing.',
    '- Match the user\'s language (Chinese, English, etc.).',
    '- Be specific: mention file names / feature names when useful.',
    '',
    '=== TURN MESSAGES ===',
  ];

  for (const m of messages) {
    if (m.role === 'user') {
      const text = extractUserText(m.content);
      lines.push(`[user] ${truncate(text, 1000)}`);
    } else if (m.role === 'system') {
      // Skip system messages — they're usually CLI bookkeeping
      continue;
    } else {
      // Assistant: render text + each tool call compactly
      const meta = parseJsonSafe<Record<string, unknown>>(m.metadata);
      const text = m.content?.trim() ?? '';
      if (text.length > 0) {
        lines.push(`[assistant] ${truncate(text, 600)}`);
      }
      const toolCalls = Array.isArray(meta?.toolCalls) ? meta.toolCalls : [];
      for (const raw of toolCalls) {
        const tc = raw as Record<string, unknown>;
        const name = String(tc.name ?? 'unknown');
        const inputText = compactToolInput(name, tc.input);
        const errored = tc.isError === true;
        lines.push(`[tool ${name}${errored ? ' FAILED' : ''}] ${inputText}`);
      }
    }
  }

  return lines.join('\n');
}

export function parseSummaryResponse(text: string): ParsedSummary {
  const candidates = extractJSONObjects(text);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(candidates[i]) as Record<string, unknown>;
      const goal = typeof parsed.goal === 'string' ? parsed.goal.trim() : '';
      const solved = typeof parsed.solved === 'string' ? parsed.solved.trim() : '';
      const openIssues = typeof parsed.openIssues === 'string' ? parsed.openIssues.trim() : '';
      if (goal && solved && openIssues) {
        return { goal, solved, openIssues };
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error('Failed to parse summary response — model output did not contain required JSON');
}

function compactToolInput(toolName: string, input: unknown): string {
  if (input == null) return '';
  const obj = (typeof input === 'object' ? input : {}) as Record<string, unknown>;
  switch (toolName) {
    case 'Edit':
    case 'NotebookEdit': {
      const path = obj.file_path ?? obj.notebook_path ?? '';
      const oldS = String(obj.old_string ?? obj.cell_id ?? '');
      const newS = String(obj.new_string ?? obj.new_source ?? '');
      return `${path} | old: ${truncate(oldS, TOOL_INPUT_PREVIEW_CHARS)} | new: ${truncate(newS, TOOL_INPUT_PREVIEW_CHARS)}`;
    }
    case 'MultiEdit': {
      const path = obj.file_path ?? '';
      const edits = Array.isArray(obj.edits) ? obj.edits : [];
      return `${path} | ${edits.length} edits`;
    }
    case 'Write': {
      const path = obj.file_path ?? '';
      const content = String(obj.content ?? '');
      return `${path} | wrote ${content.split(/\r?\n/).length} lines`;
    }
    case 'Bash':
      return truncate(String(obj.command ?? ''), 300);
    case 'Read':
      return String(obj.file_path ?? '');
    default:
      return truncate(JSON.stringify(obj), TOOL_INPUT_PREVIEW_CHARS);
  }
}

function extractUserText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return content;
  try {
    const parsed = JSON.parse(trimmed) as { text?: unknown };
    if (parsed && typeof parsed.text === 'string') return parsed.text;
  } catch {
    // fall through
  }
  return content;
}

function parseJsonSafe<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
