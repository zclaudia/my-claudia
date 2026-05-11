import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { TurnSummaryRepository } from '../repository.js';
import { buildSummaryPrompt, parseSummaryResponse } from '../service.js';
import type { TurnSummary } from '@my-claudia/shared/features/turn-summary';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE turn_summaries (
      session_id       TEXT NOT NULL,
      user_message_id  TEXT NOT NULL,
      as_of_message_id TEXT NOT NULL,
      goal             TEXT NOT NULL,
      solved           TEXT NOT NULL,
      open_issues      TEXT NOT NULL,
      model            TEXT NOT NULL,
      generated_at     INTEGER NOT NULL,
      PRIMARY KEY (session_id, user_message_id)
    );
  `);
  return db;
}

describe('TurnSummaryRepository', () => {
  let db: ReturnType<typeof createTestDb>;
  let repo: TurnSummaryRepository;

  const makeSummary = (overrides: Partial<TurnSummary> = {}): TurnSummary => ({
    sessionId: 'sess-1',
    userMessageId: 'u1',
    asOfMessageId: 'a3',
    goal: 'Add panel',
    solved: 'Added 5 files and tests',
    openIssues: '—',
    model: 'claude-haiku',
    generatedAt: 1700000000000,
    ...overrides,
  });

  beforeEach(() => {
    db = createTestDb();
    repo = new TurnSummaryRepository(db);
  });

  it('upsert + findByTurn round-trips a record', () => {
    repo.upsert(makeSummary());
    const got = repo.findByTurn('sess-1', 'u1');
    expect(got).toMatchObject({
      sessionId: 'sess-1',
      userMessageId: 'u1',
      goal: 'Add panel',
      solved: 'Added 5 files and tests',
      openIssues: '—',
    });
  });

  it('upsert overwrites existing row on (session_id, user_message_id) conflict', () => {
    repo.upsert(makeSummary({ goal: 'first' }));
    repo.upsert(makeSummary({ goal: 'second', asOfMessageId: 'a99' }));
    const got = repo.findByTurn('sess-1', 'u1');
    expect(got?.goal).toBe('second');
    expect(got?.asOfMessageId).toBe('a99');
  });

  it('findByTurn returns null when no row exists', () => {
    expect(repo.findByTurn('sess-1', 'missing')).toBeNull();
  });

  it('listBySession returns rows for the session sorted by generated_at desc', () => {
    repo.upsert(makeSummary({ userMessageId: 'u1', generatedAt: 100 }));
    repo.upsert(makeSummary({ userMessageId: 'u2', generatedAt: 300 }));
    repo.upsert(makeSummary({ userMessageId: 'u3', generatedAt: 200 }));
    const got = repo.listBySession('sess-1');
    expect(got.map((s) => s.userMessageId)).toEqual(['u2', 'u3', 'u1']);
  });

  it('deleteBySession removes all rows for a session', () => {
    repo.upsert(makeSummary({ userMessageId: 'u1' }));
    repo.upsert(makeSummary({ userMessageId: 'u2' }));
    repo.deleteBySession('sess-1');
    expect(repo.listBySession('sess-1')).toEqual([]);
  });
});

describe('parseSummaryResponse', () => {
  it('parses a clean JSON object', () => {
    const text = '{"goal": "a", "solved": "b", "openIssues": "c"}';
    expect(parseSummaryResponse(text)).toEqual({ goal: 'a', solved: 'b', openIssues: 'c' });
  });

  it('strips surrounding prose and finds the JSON', () => {
    const text = 'Sure, here is the summary:\n{"goal":"a","solved":"b","openIssues":"—"}\nThanks!';
    expect(parseSummaryResponse(text)).toEqual({ goal: 'a', solved: 'b', openIssues: '—' });
  });

  it('handles fenced code blocks', () => {
    const text = '```json\n{"goal":"a","solved":"b","openIssues":"c"}\n```';
    expect(parseSummaryResponse(text)).toEqual({ goal: 'a', solved: 'b', openIssues: 'c' });
  });

  it('throws when no valid JSON with all required fields is present', () => {
    expect(() => parseSummaryResponse('no json here')).toThrow(/Failed to parse/);
    expect(() => parseSummaryResponse('{"goal":"a"}')).toThrow(/Failed to parse/);
  });

  it('picks the last valid candidate when multiple JSON objects appear', () => {
    const text = '{"goal":"old","solved":"old","openIssues":"old"} and then {"goal":"new","solved":"new","openIssues":"new"}';
    expect(parseSummaryResponse(text)).toEqual({ goal: 'new', solved: 'new', openIssues: 'new' });
  });
});

describe('buildSummaryPrompt', () => {
  it('includes user message text extracted from JSON content', () => {
    const prompt = buildSummaryPrompt([
      {
        id: 'u1',
        role: 'user',
        content: JSON.stringify({ text: '帮我重构这段代码', attachments: [] }),
        metadata: null,
        offset: 1,
        createdAt: 100,
      },
    ]);
    expect(prompt).toContain('帮我重构这段代码');
    expect(prompt).not.toContain('{"text"'); // raw JSON should not leak through
  });

  it('serializes Edit / Write tool calls compactly with file paths', () => {
    const prompt = buildSummaryPrompt([
      { id: 'u1', role: 'user', content: 'do it', metadata: null, offset: 1, createdAt: 100 },
      {
        id: 'a1',
        role: 'assistant',
        content: 'OK',
        metadata: JSON.stringify({
          toolCalls: [
            { name: 'Edit', input: { file_path: '/repo/foo.ts', old_string: 'x', new_string: 'y' } },
            { name: 'Write', input: { file_path: '/repo/bar.ts', content: 'line1\nline2\nline3' } },
          ],
        }),
        offset: 2,
        createdAt: 110,
      },
    ]);
    expect(prompt).toContain('[tool Edit]');
    expect(prompt).toContain('/repo/foo.ts');
    expect(prompt).toContain('[tool Write]');
    expect(prompt).toContain('/repo/bar.ts');
    expect(prompt).toContain('wrote 3 lines');
  });

  it('marks failed tool calls with FAILED so the model can mention them in openIssues', () => {
    const prompt = buildSummaryPrompt([
      { id: 'u1', role: 'user', content: 'do it', metadata: null, offset: 1, createdAt: 100 },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        metadata: JSON.stringify({
          toolCalls: [
            { name: 'Edit', input: { file_path: '/repo/foo.ts', old_string: 'x', new_string: 'y' }, isError: true },
          ],
        }),
        offset: 2,
        createdAt: 110,
      },
    ]);
    expect(prompt).toContain('FAILED');
  });

  it('skips system messages', () => {
    const prompt = buildSummaryPrompt([
      { id: 'u1', role: 'user', content: 'do it', metadata: null, offset: 1, createdAt: 100 },
      { id: 's1', role: 'system', content: '<<bookkeeping>>', metadata: null, offset: 2, createdAt: 105 },
    ]);
    expect(prompt).not.toContain('<<bookkeeping>>');
  });
});
