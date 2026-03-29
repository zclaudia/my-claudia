import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runKimiReviewJob } from '../kimi-review.js';

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

describe('runKimiReviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the final JSON verdict from think-tagged assistant output', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runKimiReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
      systemPrompt: 'Return only JSON.',
    });

    stdout.push(JSON.stringify({ type: 'assistant', content: '<think>The tool call contains {"command":"adb install app.apk"} and affects a device.' }) + '\n');
    stdout.push(JSON.stringify({ type: 'assistant', content: '</think>' }) + '\n');
    stdout.push(JSON.stringify({ type: 'assistant', content: '{"type":"final","decision":"deny","reasoning":"Installing APK files via adb affects external devices.","confidence":0.9}' }) + '\n');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'deny',
      reasoning: 'Installing APK files via adb affects external devices.',
      confidence: 0.9,
      exitCode: 0,
    });
  });

  it('fails when assistant output never contains a final JSON verdict', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runKimiReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    stdout.push(JSON.stringify({ type: 'assistant', content: '<think>Reasoning only.</think>' }) + '\n');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).rejects.toThrow('Kimi review job did not produce a valid final JSON result');
  });
});
