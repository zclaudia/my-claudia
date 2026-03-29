import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIReviewQueue } from '../ai-review-queue.js';

const evaluateAIReviewMock = vi.fn();

vi.mock('../delegation-evaluator.js', () => ({
  evaluateAIReview: (...args: unknown[]) => evaluateAIReviewMock(...args),
}));

describe('AIReviewQueue', () => {
  beforeEach(() => {
    evaluateAIReviewMock.mockReset();
  });

  it('starts each queued review with a fresh session id', async () => {
    evaluateAIReviewMock
      .mockResolvedValueOnce({
        decision: 'approve',
        reasoning: 'first review',
        confidence: 0.91,
        sessionId: 'review-session-1',
      })
      .mockResolvedValueOnce({
        decision: 'approve',
        reasoning: 'second review',
        confidence: 0.93,
        sessionId: 'review-session-2',
      });

    const createProvider = vi.fn(() => ({
      runPrompt: vi.fn(),
    }));

    const queue = new AIReviewQueue({
      createProvider,
      cwd: '/workspace',
    });

    const config = {
      enabled: true,
      timeoutBeforeReview: 60,
      confidenceThreshold: 0.8,
      maxAutoApprovalsPerMinute: 10,
    };

    await queue.enqueue('req-1', config, {
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      detail: 'npm test',
      cwd: '/workspace',
    });

    await queue.enqueue('req-2', config, {
      toolName: 'Bash',
      toolInput: { command: 'npm run lint' },
      detail: 'npm run lint',
      cwd: '/workspace',
    });

    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(evaluateAIReviewMock).toHaveBeenNthCalledWith(
      1,
      config,
      expect.objectContaining({ sessionId: undefined })
    );
    expect(evaluateAIReviewMock).toHaveBeenNthCalledWith(
      2,
      config,
      expect.objectContaining({ sessionId: undefined })
    );
  });

  it('rotates provider instance when analysisProviderId changes', async () => {
    evaluateAIReviewMock
      .mockResolvedValueOnce({
        decision: 'approve',
        reasoning: 'default provider',
        confidence: 0.9,
      })
      .mockResolvedValueOnce({
        decision: 'approve',
        reasoning: 'other provider',
        confidence: 0.92,
      });

    const createProvider = vi
      .fn()
      .mockReturnValueOnce({ runPrompt: vi.fn() })
      .mockReturnValueOnce({ runPrompt: vi.fn() });

    const queue = new AIReviewQueue({
      createProvider,
      cwd: '/workspace',
    });

    const baseConfig = {
      enabled: true,
      timeoutBeforeReview: 60,
      confidenceThreshold: 0.8,
      maxAutoApprovalsPerMinute: 10,
    };

    await queue.enqueue('req-1', baseConfig, {
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      detail: 'npm test',
      cwd: '/workspace',
    });

    await queue.enqueue('req-2', { ...baseConfig, analysisProviderId: 'provider-2' }, {
      toolName: 'Bash',
      toolInput: { command: 'npm run lint' },
      detail: 'npm run lint',
      cwd: '/workspace',
    });

    expect(createProvider).toHaveBeenNthCalledWith(1, undefined);
    expect(createProvider).toHaveBeenNthCalledWith(2, 'provider-2');
  });
});
