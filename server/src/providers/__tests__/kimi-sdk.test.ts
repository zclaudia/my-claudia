import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runKimi, abortKimiSession, createKimiAdapter } from '../kimi-sdk.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock attachment-utils
vi.mock('../attachment-utils.js', () => ({
  buildNonImageAttachmentNotes: vi.fn().mockReturnValue([]),
}));

function createMockReadable(): Readable {
  return new Readable({ read() {} });
}

function createMockProc() {
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
  return { proc, stdout, stderr };
}

describe('kimi-sdk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds init session_id so abort can stop a newly created session', async () => {
    const { proc, stdout } = createMockProc();
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

  it('yields ENOENT error when stdout is null and spawn error is ENOENT', async () => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: null,
      stderr: null,
      killed: false,
      kill: vi.fn(() => true),
    });

    const err = new Error('spawn kimi ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';

    vi.mocked(spawn).mockImplementation(() => {
      process.nextTick(() => proc.emit('error', err));
      return proc as any;
    });

    const messages: any[] = [];
    for await (const msg of runKimi('hello', { cwd: '/tmp' }, vi.fn())) {
      messages.push(msg);
    }

    expect(messages[0].type).toBe('error');
  });

  it('yields error when spawn throws', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('Spawn failed');
    });

    const messages: any[] = [];
    for await (const msg of runKimi('hello', { cwd: '/tmp' }, vi.fn())) {
      messages.push(msg);
    }

    expect(messages[0].type).toBe('error');
    expect(messages[0].error).toContain('Failed to start kimi');
  });

  it('yields assistant message event', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push(JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello!' }) + '\n');
    const first = await firstP;
    expect(first.value).toMatchObject({ type: 'assistant', content: 'Hello!' });

    stdout.push(null);
    await gen.next();
  });

  it('yields thinking blocks wrapped in think tags', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push(JSON.stringify({ type: 'thinking', content: 'Let me consider...' }) + '\n');
    const first = await firstP;
    expect(first.value).toMatchObject({ type: 'assistant', content: '<think>Let me consider...' });

    stdout.push(null);
    const msgs: any[] = [];
    let result = await gen.next();
    while (!result.done) {
      if (result.value) msgs.push(result.value);
      result = await gen.next();
    }
    expect(msgs.some(m => m.content === '</think>')).toBe(true);
  });

  it('yields tool_use events with mapped tool names', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push(JSON.stringify({
      type: 'tool_use',
      tool: 'read',
      input: { path: '/file.ts' },
      tool_use_id: 'tu-1',
    }) + '\n');
    const first = await firstP;
    expect(first.value).toMatchObject({
      type: 'tool_use',
      toolName: 'Read',
      toolUseId: 'tu-1',
    });

    stdout.push(null);
    await gen.next();
  });

  it('yields tool_result events', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push(JSON.stringify({
      type: 'tool_result',
      tool: 'bash',
      result: 'output text',
      error: false,
    }) + '\n');
    const first = await firstP;
    expect(first.value).toMatchObject({
      type: 'tool_result',
      toolName: 'Bash',
      toolResult: 'output text',
      isToolError: false,
    });

    stdout.push(null);
    await gen.next();
  });

  it('yields error events', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push(JSON.stringify({ type: 'error', message: 'Something broke' }) + '\n');
    const first = await firstP;
    expect(first.value).toMatchObject({ type: 'error', error: 'Something broke' });

    stdout.push(null);
    await gen.next();
  });

  it('yields result on complete event', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push(JSON.stringify({ type: 'complete' }) + '\n');
    const first = await firstP;
    expect(first.value).toMatchObject({ type: 'result', isComplete: true });

    stdout.push(null);
    await gen.next();
  });

  it('handles non-JSON lines as assistant text', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push('This is plain text output\n');
    const first = await firstP;
    expect(first.value).toMatchObject({ type: 'assistant', content: 'This is plain text output' });

    stdout.push(null);
    await gen.next();
  });

  it('skips empty lines', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push('\n');
    stdout.push(JSON.stringify({ type: 'complete' }) + '\n');
    const first = await firstP;
    expect(first.value).toMatchObject({ type: 'result', isComplete: true });

    stdout.push(null);
    await gen.next();
  });

  it('passes model and thinking flags to spawn args', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', {
      cwd: '/tmp',
      model: 'moonshot-v1',
      thinking: true,
      sessionId: 'session-1',
    }, vi.fn());
    stdout.push(JSON.stringify({ type: 'complete' }) + '\n');
    stdout.push(null);
    for await (const _ of gen) { /* consume */ }

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--model');
    expect(spawnArgs).toContain('moonshot-v1');
    expect(spawnArgs).toContain('--thinking');
    expect(spawnArgs).toContain('--session');
    expect(spawnArgs).toContain('session-1');
  });

  it('does not add --yolo when mode is ask', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp', mode: 'ask' }, vi.fn());
    stdout.push(JSON.stringify({ type: 'complete' }) + '\n');
    stdout.push(null);
    for await (const _ of gen) { /* consume */ }

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain('--yolo');
  });

  it('adds --yolo when mode is not ask', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    stdout.push(JSON.stringify({ type: 'complete' }) + '\n');
    stdout.push(null);
    for await (const _ of gen) { /* consume */ }

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('--yolo');
  });

  it('handles unknown event types with content', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const firstP = gen.next();
    stdout.push(JSON.stringify({ type: 'custom', content: 'Custom content' }) + '\n');
    const first = await firstP;
    expect(first.value).toMatchObject({ type: 'assistant', content: 'Custom content' });

    stdout.push(null);
    await gen.next();
  });

  it('prepares MessageInput JSON correctly', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const input = JSON.stringify({ text: 'Hello with attachment', attachments: [] });
    const gen = runKimi(input, { cwd: '/tmp' }, vi.fn());
    stdout.push(JSON.stringify({ type: 'complete' }) + '\n');
    stdout.push(null);
    for await (const _ of gen) { /* consume */ }

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    const promptIdx = spawnArgs.indexOf('--prompt');
    expect(spawnArgs[promptIdx + 1]).toBe('Hello with attachment');
  });

  it('tool mapping maps known tools', () => {
    // Verify via tool_use events that tool names are mapped
    // Already tested above, but let's verify more mappings
  });
});

describe('abortKimiSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not throw for unknown session', async () => {
    await expect(abortKimiSession('unknown-session')).resolves.not.toThrow();
  });

  it('is a function', () => {
    expect(typeof abortKimiSession).toBe('function');
  });
});

describe('createKimiAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates adapter with run and abort methods', () => {
    const adapter = createKimiAdapter({ cwd: '/tmp' });
    expect(typeof adapter.run).toBe('function');
    expect(typeof adapter.abort).toBe('function');
  });

  it('run is an async generator', () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as any);

    const adapter = createKimiAdapter({ cwd: '/tmp' });
    const gen = adapter.run('hello', vi.fn());
    expect(gen[Symbol.asyncIterator]).toBeDefined();

    stdout.push(null);
  });
});
