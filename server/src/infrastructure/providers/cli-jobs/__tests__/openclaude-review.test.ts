import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import type * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runOpenClaudeReviewJob } from '../openclaude-review.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as typeof ChildProcess),
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

describe('runOpenClaudeReviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs OpenClaude review jobs with OpenAI-compatible env defaults', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runOpenClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
      env: { OPENAI_API_KEY: 'secret' },
      model: 'gpt-4o',
      systemPrompt: 'Return only JSON.',
    });

    const [binary, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(binary).toBe('openclaude');
    expect(args).toContain('--model');
    expect(args).toContain('gpt-4o');
    expect(args).toContain('--system-prompt');
    expect(options?.env).toMatchObject({
      OPENAI_API_KEY: 'secret',
      CLAUDE_CODE_USE_OPENAI: '1',
    });

    stdout.push('{"type":"final","decision":"approve","reasoning":"ok","confidence":0.9}');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'ok',
      confidence: 0.9,
    });
  });
});
