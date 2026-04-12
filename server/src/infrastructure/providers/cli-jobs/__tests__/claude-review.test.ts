import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runClaudeReviewJob } from '../claude-review.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

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

describe('runClaudeReviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the final JSON verdict from stdout', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
      systemPrompt: 'Return only JSON.',
    });

    stdout.push('{"type":"final","decision":"approve","reasoning":"Read-only command.","confidence":0.91}');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'Read-only command.',
      confidence: 0.91,
      exitCode: 0,
    });
  });

  it('fails when stdout does not contain a final JSON verdict', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    stdout.push('plain text only');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).rejects.toThrow('Claude review job did not produce a valid final JSON result');
  });

  it('extracts verdict from --output-format json envelope (non-empty result)', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '{"type":"final","decision":"deny","reasoning":"Deletes system files.","confidence":0.95}',
      stop_reason: 'end_turn',
    });
    stdout.push(envelope);
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'deny',
      reasoning: 'Deletes system files.',
      confidence: 0.95,
    });
  });

  it('falls back to envelope parsing when result is empty string', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    // Simulates the --json-schema bug: result is empty but envelope is valid JSON
    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '',
      stop_reason: 'end_turn',
    });
    stdout.push(envelope);
    stdout.push(null);
    proc.emit('close', 0);

    // sourceText stays as the full envelope string (result is empty, so not used).
    // The envelope itself has no decision field, so this should fail.
    await expect(resultPromise).rejects.toThrow('Claude review job did not produce a valid final JSON result');
  });

  it('handles result with escaped JSON inside envelope', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    const innerJson = '{"type":"final","decision":"approve","reasoning":"Safe read-only command.","confidence":0.88}';
    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: `\n\n${innerJson}`,
      stop_reason: 'end_turn',
    });
    stdout.push(envelope);
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'Safe read-only command.',
      confidence: 0.88,
    });
  });

  it('rejects when spawn emits an error', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    proc.emit('error', new Error('ENOENT: claude not found'));
    stdout.push(null);
    proc.emit('close', null);

    await expect(resultPromise).rejects.toThrow('ENOENT: claude not found');
  });

  it('rejects on timeout and kills the process', async () => {
    vi.useFakeTimers();
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
      timeoutMs: 5000,
    });

    vi.advanceTimersByTime(5000);

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    // Close after timeout to let the promise settle
    stdout.push(null);
    proc.emit('close', null);

    await expect(resultPromise).rejects.toThrow('timed out after 5000ms');
    vi.useRealTimers();
  });

  it('does not pass --json-schema flag', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
      model: 'claude-sonnet-4-5-20250514',
      systemPrompt: 'Return only JSON.',
    });

    // Verify spawn args do NOT contain --json-schema
    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain('--json-schema');
    expect(spawnArgs).toContain('--model');
    expect(spawnArgs).toContain('claude-sonnet-4-5-20250514');
    expect(spawnArgs).toContain('--system-prompt');

    stdout.push('{"type":"final","decision":"approve","reasoning":"ok","confidence":0.9}');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({ decision: 'approve' });
  });

  it('preserves rawStdout and rawStderr in the result', async () => {
    const { proc, stdout, stderr } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    stdout.push('{"type":"final","decision":"deny","reasoning":"dangerous","confidence":0.99}');
    stderr.push('some warning');
    stdout.push(null);
    stderr.push(null);
    proc.emit('close', 1);

    const result = await resultPromise;
    expect(result.rawStdout).toContain('"decision":"deny"');
    expect(result.rawStderr).toBe('some warning');
    expect(result.exitCode).toBe(1);
  });
});
