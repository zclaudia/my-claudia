import { describe, it, expect, vi } from 'vitest';

vi.mock('../kimi-review.js', () => ({
  runKimiReviewJob: vi.fn(async () => ({
    decision: 'deny',
    reasoning: 'kimi',
    confidence: 0.9,
    rawStdout: '',
    rawStderr: '',
    exitCode: 0,
  })),
}));

vi.mock('../claude-review.js', () => ({
  runClaudeReviewJob: vi.fn(async () => ({
    decision: 'approve',
    reasoning: 'claude',
    confidence: 0.8,
    rawStdout: '',
    rawStderr: '',
    exitCode: 0,
  })),
}));

vi.mock('../openclaude-review.js', () => ({
  runOpenClaudeReviewJob: vi.fn(async () => ({
    decision: 'approve',
    reasoning: 'openclaude',
    confidence: 0.75,
    rawStdout: '',
    rawStderr: '',
    exitCode: 0,
  })),
}));

vi.mock('../cursor-review.js', () => ({
  runCursorReviewJob: vi.fn(async () => ({
    decision: 'approve',
    reasoning: 'cursor',
    confidence: 0.7,
    rawStdout: '',
    rawStderr: '',
    exitCode: 0,
  })),
}));

vi.mock('../opencode-review.js', () => ({
  runOpenCodeReviewJob: vi.fn(async () => ({
    decision: 'uncertain',
    reasoning: 'opencode',
    confidence: 0.6,
    rawStdout: '',
    rawStderr: '',
    exitCode: 0,
  })),
}));

vi.mock('../codex-review.js', () => ({
  runCodexReviewJob: vi.fn(async () => ({
    decision: 'deny',
    reasoning: 'codex',
    confidence: 0.95,
    rawStdout: '',
    rawStderr: '',
    exitCode: 0,
  })),
}));

import { supportsAIReviewCliJob, runAIReviewCliJob } from '../review-job.js';

describe('review-job', () => {
  it('reports supported provider types', () => {
    expect(supportsAIReviewCliJob('kimi')).toBe(true);
    expect(supportsAIReviewCliJob('claude')).toBe(true);
    expect(supportsAIReviewCliJob('openclaude')).toBe(true);
    expect(supportsAIReviewCliJob('cursor')).toBe(true);
    expect(supportsAIReviewCliJob('opencode')).toBe(true);
    expect(supportsAIReviewCliJob('codex')).toBe(true);
  });

  it('dispatches to the matching provider runner', async () => {
    await expect(runAIReviewCliJob('kimi', { prompt: 'p', cwd: '/tmp' })).resolves.toMatchObject({
      decision: 'deny',
      reasoning: 'kimi',
    });

    await expect(runAIReviewCliJob('claude', { prompt: 'p', cwd: '/tmp' })).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'claude',
    });

    await expect(runAIReviewCliJob('openclaude', { prompt: 'p', cwd: '/tmp' })).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'openclaude',
    });

    await expect(runAIReviewCliJob('cursor', { prompt: 'p', cwd: '/tmp' })).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'cursor',
    });

    await expect(runAIReviewCliJob('opencode', { prompt: 'p', cwd: '/tmp' })).resolves.toMatchObject({
      decision: 'uncertain',
      reasoning: 'opencode',
    });

    await expect(runAIReviewCliJob('codex', { prompt: 'p', cwd: '/tmp' })).resolves.toMatchObject({
      decision: 'deny',
      reasoning: 'codex',
    });
  });
});
