import type { UnifiedPermissionPolicy } from '@my-claudia/shared/interaction/permissions';
import type { DelegationConfig } from '@my-claudia/shared/features/delegation';
import { DEFAULT_DELEGATION_CONFIG } from '@my-claudia/shared/features/delegation';
import type Database from 'better-sqlite3';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Rate limiter: circular buffer tracking approvals per minute
let approvalTimestamps: number[] = [];
let approvalStartIdx = 0;
export const AI_REVIEW_DEBUG_ENABLED = process.env.MY_CLAUDIA_AI_REVIEW_DEBUG === '1';
export const AI_REVIEW_LOG_PATH = process.env.MY_CLAUDIA_DATA_DIR
  ? `${process.env.MY_CLAUDIA_DATA_DIR}/ai-review-debug.log`
  : '/tmp/my-claudia-ai-review.log';

export function appendAIReviewDebugLog(message: string): void {
  if (!AI_REVIEW_DEBUG_ENABLED) return;
  try {
    mkdirSync(dirname(AI_REVIEW_LOG_PATH), { recursive: true });
    appendFileSync(AI_REVIEW_LOG_PATH, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Best-effort debug logging only.
  }
}

export function logAIReviewPayload(kind: 'prompt' | 'response', turn: number, sessionId: string | undefined, payload: string): void {
  if (!AI_REVIEW_DEBUG_ENABLED) return;
  appendAIReviewDebugLog(
    [
      `kind=${kind}`,
      `turn=${turn}`,
      `sessionId=${sessionId || 'new'}`,
      `${kind.toUpperCase()}<<EOF`,
      payload,
      'EOF',
    ].join('\n')
  );
}

export function isRateLimited(maxPerMinute: number): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  while (approvalStartIdx < approvalTimestamps.length && approvalTimestamps[approvalStartIdx] < oneMinuteAgo) {
    approvalStartIdx++;
  }
  if (approvalStartIdx > approvalTimestamps.length / 2) {
    approvalTimestamps = approvalTimestamps.slice(approvalStartIdx);
    approvalStartIdx = 0;
  }
  return (approvalTimestamps.length - approvalStartIdx) >= maxPerMinute;
}

export function recordApproval(): void {
  approvalTimestamps.push(Date.now());
}

/** @internal Test-only: reset the rate limiter state */
export function _resetRateLimiterForTesting(): void {
  approvalTimestamps = [];
  approvalStartIdx = 0;
}

/** Load delegation config from DB */
export function getDelegationConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement.get() uses variadic params
  db: { prepare: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined } }
): DelegationConfig {
  try {
    const row = db.prepare('SELECT config FROM delegation_config WHERE id = 1')
      .get() as { config: string } | undefined;
    if (!row?.config) return DEFAULT_DELEGATION_CONFIG;
    return { ...DEFAULT_DELEGATION_CONFIG, ...JSON.parse(row.config) };
  } catch {
    return DEFAULT_DELEGATION_CONFIG;
  }
}

/** Save delegation config to DB */
export function saveDelegationConfig(
  db: Database.Database,
  config: DelegationConfig
): void {
  db.prepare('UPDATE delegation_config SET config = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(config), Date.now());
}

export interface DelegationContext {
  toolName: string;
  toolInput: unknown;
  detail: string;
  sessionType: 'regular' | 'background' | 'agent';
  policy: UnifiedPermissionPolicy;
  /** @deprecated Provider to use for LLM analysis — uses legacy string-only interface */
  analysisProvider?: {
    runPrompt: (prompt: string) => Promise<string>;
  };
}
