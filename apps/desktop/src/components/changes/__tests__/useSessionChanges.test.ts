import { describe, it, expect } from 'vitest';
import { aggregateSessionChanges } from '../useSessionChanges';
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
