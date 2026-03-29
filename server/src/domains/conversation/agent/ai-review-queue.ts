/**
 * AIReviewQueue — Serialized AI review with shared session reuse.
 *
 * One queue per activeRun. Reviews are processed one at a time through a
 * shared provider session to avoid spawning multiple CLI processes.
 *
 * Session lifecycle:
 * - Each review request starts with a fresh provider session.
 * - Multi-turn follow-ups inside a single review still reuse the session ID
 *   returned by evaluateAIReview().
 *
 * Rationale:
 * - Reusing one provider conversation across unrelated permission requests
 *   makes structured JSON output drift over time, especially with CLI-backed
 *   providers such as Kimi.
 *
 * Cancellation:
 * - cancel(requestId): marks a queued/in-flight review as cancelled.
 * - cancelAll(): cancels all pending reviews (run ended).
 */

import type { AIReviewConfig, AIReviewResult } from '@my-claudia/shared';
import { evaluateAIReview, type AIReviewContext, type AIReviewProvider } from './delegation-evaluator.js';

export interface AIReviewQueueOptions {
  /** Factory to create/resolve the analysis provider. Called once per queue lifetime (or on rotation). */
  createProvider: (analysisProviderId?: string) => AIReviewProvider | undefined;
  /** Workspace root for script content reading */
  cwd: string;
}

interface QueueEntry {
  requestId: string;
  config: AIReviewConfig;
  ctx: Omit<AIReviewContext, 'analysisProvider' | 'sessionId'>;
  resolve: (result: AIReviewResult) => void;
  cancelled: boolean;
}

const CANCELLED_RESULT: AIReviewResult = {
  decision: 'uncertain',
  reasoning: 'Cancelled: user resolved permission manually',
  confidence: 0,
};

export class AIReviewQueue {
  private queue: QueueEntry[] = [];
  private processing = false;
  private currentEntry: QueueEntry | null = null;

  /** Cached provider instance (created once from factory) */
  private cachedProvider: AIReviewProvider | undefined;
  private cachedProviderId: string | undefined;

  private options: AIReviewQueueOptions;

  constructor(options: AIReviewQueueOptions) {
    this.options = options;
  }

  /**
   * Enqueue an AI review. The queue handles provider creation and session reuse.
   * ctx should NOT include analysisProvider or sessionId — the queue manages those.
   */
  enqueue(
    requestId: string,
    config: AIReviewConfig,
    ctx: Omit<AIReviewContext, 'analysisProvider' | 'sessionId'>,
  ): Promise<AIReviewResult> {
    return new Promise<AIReviewResult>((resolve) => {
      this.queue.push({ requestId, config, ctx, resolve, cancelled: false });
      this.processNext();
    });
  }

  /**
   * Cancel a pending or in-flight review by requestId.
   */
  cancel(requestId: string): void {
    if (this.currentEntry?.requestId === requestId) {
      this.currentEntry.cancelled = true;
    }
    for (const entry of this.queue) {
      if (entry.requestId === requestId) {
        entry.cancelled = true;
      }
    }
  }

  /** Cancel all pending reviews (e.g., run ended) */
  cancelAll(): void {
    if (this.currentEntry) {
      this.currentEntry.cancelled = true;
    }
    for (const entry of this.queue) {
      entry.cancelled = true;
      entry.resolve(CANCELLED_RESULT);
    }
    this.queue = [];
  }

  get pendingCount(): number {
    return this.queue.filter(e => !e.cancelled).length;
  }

  /** Resolve the provider, caching it. Rotates if analysisProviderId changes. */
  private getProvider(analysisProviderId?: string): AIReviewProvider | undefined {
    if (this.cachedProvider && this.cachedProviderId === (analysisProviderId || '__default__')) {
      return this.cachedProvider;
    }
    this.cachedProvider = this.options.createProvider(analysisProviderId);
    this.cachedProviderId = analysisProviderId || '__default__';
    return this.cachedProvider;
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;

    // Skip cancelled entries at the front
    while (this.queue.length > 0 && this.queue[0].cancelled) {
      this.queue.shift()!.resolve(CANCELLED_RESULT);
    }

    const entry = this.queue.shift();
    if (!entry) return;

    this.currentEntry = entry;
    this.processing = true;
    try {
      if (entry.cancelled) {
        entry.resolve(CANCELLED_RESULT);
        return;
      }

      const provider = this.getProvider(entry.config.analysisProviderId);
      if (!provider) {
        console.log(`[AI Review Queue] No provider available (analysisProviderId=${entry.config.analysisProviderId || 'default'})`);
        entry.resolve({ decision: 'uncertain', reasoning: 'No AI review provider available', confidence: 0 });
        return;
      }

      const result = await evaluateAIReview(entry.config, {
        ...entry.ctx,
        analysisProvider: provider,
        sessionId: undefined,
      });

      // Check again — user might have resolved while LLM was thinking
      if (entry.cancelled) {
        entry.resolve(CANCELLED_RESULT);
      } else {
        entry.resolve(result);
      }
    } catch (err) {
      entry.resolve({
        decision: 'uncertain',
        reasoning: `AI review failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        confidence: 0,
      });
    } finally {
      this.currentEntry = null;
      this.processing = false;
      setImmediate(() => this.processNext());
    }
  }
}
