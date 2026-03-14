import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runKimi, abortKimiSession } from '../kimi-sdk.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

function createMockReadable(): Readable {
  return new Readable({ read() {} });
}

describe('kimi-sdk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds init session_id so abort can stop a newly created session', async () => {
    const stdout = createMockReadable();
    const stderr = createMockReadable();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(function killMock(this: { killed: boolean }) {
        this.killed = true;
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const first = gen.next();
    stdout.push(JSON.stringify({ type: 'init', session_id: 'kimi-session-1' }) + '\n');
    const firstMsg = await first;
    expect(firstMsg.value).toMatchObject({
      type: 'init',
      sessionId: 'kimi-session-1',
    });

    await abortKimiSession('kimi-session-1');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    stdout.push(null);
    await gen.next();
  });

  it('yields an error instead of crashing when process stdout is unavailable', async () => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: null,
      stderr: null,
      killed: false,
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const messages: any[] = [];
    for await (const msg of runKimi('hello', { cwd: '/tmp' }, vi.fn())) {
      messages.push(msg);
    }

    expect(messages.some((m) => m.type === 'error')).toBe(true);
  });

  it('parses assistant text from nested message payloads', async () => {
    const stdout = createMockReadable();
    const stderr = createMockReadable();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const first = gen.next();

    stdout.push(JSON.stringify({
      type: 'message',
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello from nested content' },
        ],
      },
    }) + '\n');
    stdout.push(null);

    const result = await first;
    expect(result.value).toMatchObject({
      type: 'assistant',
      content: 'Hello from nested content',
    });
  });

  it('parses assistant delta style events', async () => {
    const stdout = createMockReadable();
    const stderr = createMockReadable();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const first = gen.next();

    stdout.push(JSON.stringify({
      type: 'assistant_delta',
      delta: { text: 'delta reply' },
    }) + '\n');
    stdout.push(null);

    const result = await first;
    expect(result.value).toMatchObject({
      type: 'assistant',
      content: 'delta reply',
    });
  });

  it('parses tool_call events with function-style arguments', async () => {
    const stdout = createMockReadable();
    const stderr = createMockReadable();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const first = gen.next();

    stdout.push(JSON.stringify({
      type: 'tool_call',
      call_id: 'call-1',
      function: {
        name: 'read',
        arguments: JSON.stringify({ file_path: '/tmp/a.ts' }),
      },
    }) + '\n');
    stdout.push(null);

    const result = await first;
    expect(result.value).toMatchObject({
      type: 'tool_use',
      toolName: 'Read',
      toolInput: { file_path: '/tmp/a.ts' },
      toolUseId: 'call-1',
    });
  });

  it('does not leak tool-like content into assistant text', async () => {
    const stdout = createMockReadable();
    const stderr = createMockReadable();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const messages: any[] = [];
    const collect = (async () => {
      for await (const msg of runKimi('hello', { cwd: '/tmp' }, vi.fn())) {
        messages.push(msg);
      }
    })();

    stdout.push(JSON.stringify({
      type: 'delta',
      tool: 'read',
      content: '<system>546 lines read from file</system>',
    }) + '\n');
    stdout.push(null);

    await collect;
    expect(messages).toEqual([]);
  });

  it('keeps reasoning deltas inside think blocks instead of visible assistant text', async () => {
    const stdout = createMockReadable();
    const stderr = createMockReadable();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const messages: any[] = [];
    const collect = (async () => {
      for await (const msg of runKimi('hello', { cwd: '/tmp' }, vi.fn())) {
        messages.push(msg);
      }
    })();

    stdout.push(JSON.stringify({
      type: 'delta',
      reasoning: true,
      content: 'internal reasoning',
    }) + '\n');
    stdout.push(JSON.stringify({
      type: 'delta',
      content: 'visible answer',
      is_complete: true,
    }) + '\n');
    stdout.push(null);

    await collect;

    expect(messages).toEqual([
      { type: 'assistant', content: '<think>internal reasoning' },
      { type: 'assistant', content: '</think>visible answer' },
      { type: 'result', isComplete: true },
    ]);
  });
});
