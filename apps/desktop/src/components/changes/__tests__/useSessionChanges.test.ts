import { describe, it, expect } from 'vitest';
import {
  aggregateSessionChanges,
  buildIssueFromSummary,
  hasOpenIssues,
  isTurnEmpty,
  type TurnStat,
} from '../useSessionChanges';
import type { MessageWithToolCalls, ToolCallState } from '../../../stores/chatStore';

const PROJECT_ROOT = '/repo';

function tool(
  id: string,
  toolName: string,
  toolInput: unknown,
  status: ToolCallState['status'] = 'completed',
  isError = false,
): ToolCallState {
  return { id, toolName, toolInput, status, isError };
}

function userMsg(id: string, content: string, t: number): MessageWithToolCalls {
  return { id, sessionId: 's', role: 'user', content, createdAt: t };
}

function assistantMsg(
  id: string,
  toolCalls: ToolCallState[],
  t: number,
): MessageWithToolCalls {
  return { id, sessionId: 's', role: 'assistant', content: '', createdAt: t, toolCalls };
}

describe('aggregateSessionChanges', () => {
  it('returns empty when there are no messages', () => {
    const r = aggregateSessionChanges({
      messages: [],
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified).toEqual([]);
    expect(r.affected).toEqual([]);
  });

  it('collects Edit calls and normalizes paths against projectRoot', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'fix it', 100),
      assistantMsg('a1', [
        tool('t1', 'Edit', {
          file_path: '/repo/src/foo.ts',
          old_string: 'a',
          new_string: 'b',
        }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified).toHaveLength(1);
    expect(r.modified[0].path).toBe('src/foo.ts');
    expect(r.modified[0].absolutePath).toBe('/repo/src/foo.ts');
    expect(r.modified[0].toolCounts).toEqual({ Edit: 1 });
    expect(r.modified[0].groups).toHaveLength(1);
    expect(r.modified[0].groups[0].fragments).toHaveLength(1);
    expect(r.modified[0].groups[0].fragments[0]).toMatchObject({
      kind: 'edit',
      oldText: 'a',
      newText: 'b',
      toolName: 'Edit',
    });
  });

  it('filters out failed tool calls (isError or non-completed status)', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'try', 100),
      assistantMsg('a1', [
        tool('t1', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }, 'completed', true),
        tool('t2', 'Edit', { file_path: '/repo/b.ts', old_string: 'x', new_string: 'y' }, 'running'),
        tool('t3', 'Write', { file_path: '/repo/c.ts', content: 'ok' }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified.map((m) => m.path)).toEqual(['c.ts']);
  });

  it('groups same-file edits within a single user turn together', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'first turn', 100),
      assistantMsg('a1', [
        tool('t1', 'Edit', { file_path: '/repo/x.ts', old_string: 'a', new_string: 'b' }),
        tool('t2', 'Edit', { file_path: '/repo/x.ts', old_string: 'b', new_string: 'c' }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified).toHaveLength(1);
    expect(r.modified[0].toolCounts).toEqual({ Edit: 2 });
    expect(r.modified[0].groups).toHaveLength(1);
    expect(r.modified[0].groups[0].fragments).toHaveLength(2);
  });

  it('splits fragments into separate groups when user message changes', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'first ask', 100),
      assistantMsg('a1', [tool('t1', 'Edit', { file_path: '/repo/x.ts', old_string: 'a', new_string: 'b' })], 110),
      userMsg('u2', 'second ask', 200),
      assistantMsg('a2', [tool('t2', 'Edit', { file_path: '/repo/x.ts', old_string: 'b', new_string: 'c' })], 210),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified).toHaveLength(1);
    expect(r.modified[0].toolCounts).toEqual({ Edit: 2 });
    expect(r.modified[0].groups).toHaveLength(2);
    expect(r.modified[0].groups[0].sinceUserMessageId).toBe('u1');
    expect(r.modified[0].groups[1].sinceUserMessageId).toBe('u2');
  });

  it('expands MultiEdit edits[] into per-edit fragments', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'multiedit', 100),
      assistantMsg('a1', [
        tool('t1', 'MultiEdit', {
          file_path: '/repo/x.ts',
          edits: [
            { old_string: 'a', new_string: 'b' },
            { old_string: 'c', new_string: 'd' },
            { old_string: 'e', new_string: 'f', replace_all: true },
          ],
        }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified[0].toolCounts).toEqual({ MultiEdit: 1 });
    expect(r.modified[0].groups[0].fragments).toHaveLength(3);
    expect(r.modified[0].groups[0].fragments[2]).toMatchObject({ replaceAll: true });
  });

  it('respects sinceMessageId — only messages at or after the cutoff count', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'old', 100),
      assistantMsg('a1', [tool('t1', 'Edit', { file_path: '/repo/old.ts', old_string: 'a', new_string: 'b' })], 110),
      userMsg('u2', 'new', 200),
      assistantMsg('a2', [tool('t2', 'Edit', { file_path: '/repo/new.ts', old_string: 'a', new_string: 'b' })], 210),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: 'u2',
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified.map((m) => m.path)).toEqual(['new.ts']);
  });

  it('orders modified entries by lastTimestamp descending', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 't', 100),
      assistantMsg('a1', [tool('t1', 'Edit', { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })], 110),
      assistantMsg('a2', [tool('t2', 'Edit', { file_path: '/repo/b.ts', old_string: 'a', new_string: 'b' })], 120),
      assistantMsg('a3', [tool('t3', 'Edit', { file_path: '/repo/a.ts', old_string: 'b', new_string: 'c' })], 130),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    // a.ts last touched at 130, b.ts at 120
    expect(r.modified.map((m) => m.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('extracts NotebookEdit via notebook_path', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'nb', 100),
      assistantMsg('a1', [
        tool('t1', 'NotebookEdit', {
          notebook_path: '/repo/nb.ipynb',
          cell_id: 'cell-1',
          new_source: "print('hi')",
          edit_mode: 'replace',
        }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified).toHaveLength(1);
    expect(r.modified[0].path).toBe('nb.ipynb');
    expect(r.modified[0].groups[0].fragments[0]).toMatchObject({
      kind: 'notebook',
      editMode: 'replace',
      cellId: 'cell-1',
    });
  });

  it('detects destructive bash commands rm / rmdir / mv / git reset', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'cleanup', 100),
      assistantMsg('a1', [
        tool('t1', 'Bash', { command: 'rm -rf /repo/tmp/x' }),
        tool('t2', 'Bash', { command: 'rmdir /repo/empty' }),
        tool('t3', 'Bash', { command: 'mv /repo/a.ts /repo/b.ts' }),
        tool('t4', 'Bash', { command: 'git reset --hard HEAD~1' }),
        tool('t5', 'Bash', { command: 'ls -la' }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.affected).toHaveLength(4);
    expect(r.affected[0].command).toContain('rm -rf');
    expect(r.affected[0].path).toBe('tmp/x');
    expect(r.affected[1].path).toBe('empty');
    expect(r.affected[2].path).toBe('b.ts');
    expect(r.affected[3].command).toContain('git reset');
    expect(r.affected[3].path).toBeUndefined();
  });

  it('splits chained bash commands on && / ; and detects each segment', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'chain', 100),
      assistantMsg('a1', [
        tool('t1', 'Bash', { command: 'echo hi && rm /repo/a; mv /repo/b /repo/c' }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.affected).toHaveLength(2);
    expect(r.affected[0].path).toBe('a');
    expect(r.affected[1].path).toBe('c');
  });

  it('leaves paths outside projectRoot untouched', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 't', 100),
      assistantMsg('a1', [
        tool('t1', 'Edit', { file_path: '/elsewhere/foo.ts', old_string: 'a', new_string: 'b' }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified[0].path).toBe('/elsewhere/foo.ts');
  });

  it('extracts plain text from JSON-serialized user messages for preview', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', JSON.stringify({ text: '你是否可以帮我清理这些无用的代码', attachments: [] }), 100),
      assistantMsg('a1', [
        tool('t1', 'Edit', { file_path: '/repo/x.ts', old_string: 'a', new_string: 'b' }),
      ], 110),
      userMsg('u2', JSON.stringify({ text: 'follow up' }), 200),
      assistantMsg('a2', [
        tool('t2', 'Edit', { file_path: '/repo/x.ts', old_string: 'b', new_string: 'c' }),
      ], 210),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified[0].groups[0].sinceUserMessagePreview).toBe('你是否可以帮我清理这些无用的代码');
    expect(r.modified[0].groups[1].sinceUserMessagePreview).toBe('follow up');
  });

  it('leaves plain-text user messages (e.g. slash commands) untouched in preview', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', '/commit', 100),
      assistantMsg('a1', [
        tool('t1', 'Edit', { file_path: '/repo/x.ts', old_string: 'a', new_string: 'b' }),
      ], 110),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified[0].groups[0].sinceUserMessagePreview).toBe('/commit');
  });

  it('emits per-turn stats keyed by user message id', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'first', 100),
      assistantMsg('a1', [
        tool('t1', 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }),
        tool('t2', 'Edit', { file_path: '/repo/a.ts', old_string: 'y', new_string: 'z' }),
        tool('t3', 'Write', { file_path: '/repo/b.ts', content: 'hi' }),
        tool('t4', 'Bash', { command: 'ls' }),
      ], 110),
      userMsg('u2', 'second', 200),
      assistantMsg('a2', [
        tool('t5', 'MultiEdit', {
          file_path: '/repo/c.ts',
          edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }],
        }),
      ], 210),
    ];
    const r = aggregateSessionChanges({ messages, sinceMessageId: null, projectRoot: PROJECT_ROOT });
    expect(r.turns).toHaveLength(2);
    expect(r.turns[0]).toMatchObject({
      userMessageId: 'u1',
      stats: { fileCount: 2, editCount: 2, writeCount: 1, bashCount: 1, destructiveBashCount: 0, failureCount: 0 },
    });
    expect(r.turns[1]).toMatchObject({
      userMessageId: 'u2',
      stats: { fileCount: 1, editCount: 2 },
    });
  });

  it('counts failures and pending AskUserQuestions in stats but excludes them from modified files', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'try', 100),
      assistantMsg('a1', [
        tool('t1', 'Edit', { file_path: '/repo/x.ts', old_string: 'a', new_string: 'b' }, 'completed', true), // failure
        tool('t2', 'Edit', { file_path: '/repo/y.ts', old_string: 'a', new_string: 'b' }, 'error'),           // failure
        tool('t3', 'AskUserQuestion', { questions: [] }, 'running'),                                          // pending
        tool('t4', 'Bash', { command: 'find .' }, 'running'),                                                 // running
        tool('t5', 'Edit', { file_path: '/repo/z.ts', old_string: 'a', new_string: 'b' }),                    // success
      ], 110),
    ];
    const r = aggregateSessionChanges({ messages, sinceMessageId: null, projectRoot: PROJECT_ROOT });
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].stats).toMatchObject({
      fileCount: 1,
      editCount: 1,
      failureCount: 2,
      pendingQuestionCount: 1,
      runningToolCount: 1,
      bashCount: 1,
    });
    expect(r.modified.map((m) => m.path)).toEqual(['z.ts']);
  });

  it('materialises a turn even when the user message has no tool calls yet', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'just sent', 100),
    ];
    const r = aggregateSessionChanges({ messages, sinceMessageId: null, projectRoot: PROJECT_ROOT });
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0].userMessageId).toBe('u1');
    expect(r.turns[0].stats.fileCount).toBe(0);
  });

  it('orders turns chronologically (oldest first)', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'a', 100),
      userMsg('u2', 'b', 200),
      userMsg('u3', 'c', 300),
    ];
    const r = aggregateSessionChanges({ messages, sinceMessageId: null, projectRoot: PROJECT_ROOT });
    expect(r.turns.map((t) => t.userMessageId)).toEqual(['u1', 'u2', 'u3']);
  });

  it('counts destructive bash separately from total bash', () => {
    const messages: MessageWithToolCalls[] = [
      userMsg('u1', 'cleanup', 100),
      assistantMsg('a1', [
        tool('t1', 'Bash', { command: 'ls' }),
        tool('t2', 'Bash', { command: 'rm -rf /repo/tmp' }),
        tool('t3', 'Bash', { command: 'echo hi && rm /repo/x' }),
      ], 110),
    ];
    const r = aggregateSessionChanges({ messages, sinceMessageId: null, projectRoot: PROJECT_ROOT });
    expect(r.turns[0].stats.bashCount).toBe(3);
    expect(r.turns[0].stats.destructiveBashCount).toBe(2);
  });

  it('isTurnEmpty detects no-activity turns vs turns with any signal', () => {
    const blank: TurnStat = {
      userMessageId: 'u1',
      userMessagePreview: 'hi',
      timestamp: 100,
      lastMessageId: 'u1',
      stats: {
        fileCount: 0, editCount: 0, writeCount: 0, notebookEditCount: 0,
        bashCount: 0, destructiveBashCount: 0,
        failureCount: 0, pendingQuestionCount: 0, runningToolCount: 0,
      },
    };
    expect(isTurnEmpty(blank)).toBe(true);
    // Any single signal flips it
    expect(isTurnEmpty({ ...blank, stats: { ...blank.stats, fileCount: 1 } })).toBe(false);
    expect(isTurnEmpty({ ...blank, stats: { ...blank.stats, bashCount: 1 } })).toBe(false);
    expect(isTurnEmpty({ ...blank, stats: { ...blank.stats, failureCount: 1 } })).toBe(false);
    expect(isTurnEmpty({ ...blank, stats: { ...blank.stats, pendingQuestionCount: 1 } })).toBe(false);
    expect(isTurnEmpty({ ...blank, stats: { ...blank.stats, runningToolCount: 1 } })).toBe(false);
  });

  describe('hasOpenIssues', () => {
    it('returns false for sentinel "nothing remains" values', () => {
      expect(hasOpenIssues('—')).toBe(false);
      expect(hasOpenIssues('-')).toBe(false);
      expect(hasOpenIssues('  — ')).toBe(false);
      expect(hasOpenIssues('无')).toBe(false);
      expect(hasOpenIssues('None')).toBe(false);
      expect(hasOpenIssues('nothing remains')).toBe(false);
      expect(hasOpenIssues('No open issues.')).toBe(false);
      expect(hasOpenIssues('')).toBe(false);
    });

    it('returns true for any non-trivial description', () => {
      expect(hasOpenIssues('2 failed tool calls remain')).toBe(true);
      expect(hasOpenIssues('Tests on macOS still fail.')).toBe(true);
      expect(hasOpenIssues('用户还没确认是否要持久化')).toBe(true);
    });
  });

  describe('buildIssueFromSummary', () => {
    const args = {
      openIssues: 'Tests on macOS still fail. Need to check the CI logs for the exact error.',
      goal: 'Make the macOS build green',
      userMessagePreview: 'fix macOS CI',
      turnTimestamp: 1700000000000,
    };

    it('uses the first sentence as the title', () => {
      const { title } = buildIssueFromSummary(args);
      expect(title).toBe('Tests on macOS still fail');
    });

    it('truncates long titles to 80 chars with an ellipsis', () => {
      const longText = 'a'.repeat(200);
      const { title } = buildIssueFromSummary({ ...args, openIssues: longText });
      expect(title.length).toBeLessThanOrEqual(80);
      expect(title.endsWith('…')).toBe(true);
    });

    it('embeds openIssues text first, then a Context footer with turn + goal', () => {
      const { description } = buildIssueFromSummary(args);
      const openIdx = description.indexOf(args.openIssues.trim());
      const contextIdx = description.indexOf('**Context**');
      expect(openIdx).toBeGreaterThanOrEqual(0);
      expect(contextIdx).toBeGreaterThan(openIdx);
      expect(description).toContain(args.userMessagePreview);
      expect(description).toContain(args.goal);
    });

    it('handles Chinese punctuation when splitting the first sentence', () => {
      const { title } = buildIssueFromSummary({
        ...args,
        openIssues: '存在 2 个失败的工具调用。需要查看日志确认具体原因。',
      });
      expect(title).toBe('存在 2 个失败的工具调用');
    });
  });

  it('handles tool calls before any user message by anchoring to a placeholder group', () => {
    const messages: MessageWithToolCalls[] = [
      assistantMsg('a1', [
        tool('t1', 'Edit', { file_path: '/repo/x.ts', old_string: 'a', new_string: 'b' }),
      ], 50),
      userMsg('u1', 'hi', 100),
    ];
    const r = aggregateSessionChanges({
      messages,
      sinceMessageId: null,
      projectRoot: PROJECT_ROOT,
    });
    expect(r.modified).toHaveLength(1);
    expect(r.modified[0].groups).toHaveLength(1);
    expect(r.modified[0].groups[0].sinceUserMessageId).toBe('__pre_a1');
  });
});
