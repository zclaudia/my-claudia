/**
 * Delegation Evaluator — AI-assisted permission auto-resolution.
 *
 * v3: evaluateAIReview() — triggered on timeout for escalated commands.
 * @deprecated v2: evaluateDelegation() — kept for backward compat.
 */

import type { AIReviewConfig, AIReviewResult } from '@my-claudia/shared/interaction/permissions';
import type { DelegationConfig, DelegationDecision } from '@my-claudia/shared/features/delegation';
import { classify } from './permission-evaluator.js';
import {
  guardReviewText,
  type ReviewPayloadDisposition,
} from './review-payload-guard.js';
import { resolve, isAbsolute } from 'path';
import {
  isRateLimited,
  recordApproval,
  appendAIReviewDebugLog,
  logAIReviewPayload,
  type DelegationContext,
} from './delegation/config.js';
import {
  summarizeAIReviewResponse,
  buildRepairPrompt,
  parseAIReviewResponse,
  type AIReviewModelResponse,
  type ExtendedAIReviewMetadata,
} from './delegation/ai-review-parsing.js';
import {
  MAX_REVIEW_FILES,
  MAX_REVIEW_TURNS,
  collectCandidateScripts,
  readReviewFile,
  buildInitialReviewPrompt,
  buildFileResultPrompt,
} from './delegation/script-discovery.js';

export {
  getDelegationConfig,
  saveDelegationConfig,
  _resetRateLimiterForTesting,
  type DelegationContext,
} from './delegation/config.js';

/** Wrap a legacy string-returning provider to the new AIReviewProvider interface */
function wrapLegacyProvider(legacy: { runPrompt: (prompt: string) => Promise<string> }): AIReviewProvider {
  return {
    runPrompt: async (prompt: string, _sessionId?: string) => ({
      response: await legacy.runPrompt(prompt),
      sessionId: undefined,
    }),
  };
}

// ============================================
// v3: AI Review — triggered on timeout for escalated commands
// ============================================

/** Provider interface for AI review LLM calls */
export interface AIReviewProvider {
  runPrompt: (prompt: string, sessionId?: string) => Promise<{ response: string; sessionId?: string }>;
}

export interface AIReviewContext {
  toolName: string;
  toolInput: unknown;
  detail: string;
  /** Workspace root — used to resolve relative script paths */
  cwd?: string;
  /** Provider to use for LLM analysis */
  analysisProvider?: AIReviewProvider;
  /** Resolved provider CLI path override for OneShotTaskRuntime */
  providerCliPath?: string;
  /** Resolved provider env override for OneShotTaskRuntime */
  providerEnv?: Record<string, string>;
  /** Shared session ID for session reuse (managed by AIReviewQueue) */
  sessionId?: string;
  /** Optional OneShotTaskRuntime — when provided, AI review uses the runtime pipeline */
  oneShotRuntime?: import('../../oneshot/types.js').OneShotTaskRuntime;
  /** Provider type for runtime bridge selection (e.g. 'claude') */
  providerType?: string;
}

// AIReviewResult is re-exported from @my-claudia/shared
export type { AIReviewResult } from '@my-claudia/shared/interaction/permissions';

/**
 * AI review for escalated permission requests — triggered after user timeout.
 *
 * Flow:
 * 1. Rate limited? → uncertain
 * 2. LLM analysis → decision with confidence
 * 3. Confidence < threshold? → uncertain (keep waiting for user)
 */
/** AI review result extended with session ID for reuse */
export interface AIReviewResultWithSession extends AIReviewResult {
  sessionId?: string;
}

export async function evaluateAIReview(
  config: AIReviewConfig,
  ctx: AIReviewContext,
): Promise<AIReviewResultWithSession> {
  // 1. Rate limit
  if (isRateLimited(config.maxAutoApprovalsPerMinute)) {
    console.log(`[AI Review] Skipped: rate limit exceeded`);
    return { decision: 'uncertain', reasoning: 'Rate limit exceeded', confidence: 0 };
  }

  // 2. LLM analysis
  if (!ctx.analysisProvider) {
    console.log(`[AI Review] Skipped: no analysis provider available`);
    return { decision: 'uncertain', reasoning: 'No LLM provider for risk analysis', confidence: 0 };
  }

  try {
    let llmResult: AIReviewResultWithSession;

    // Try runtime path first if available
    if (ctx.oneShotRuntime && ctx.providerType) {
      console.log(`[AI Review] Running via OneShotTaskRuntime for: ${ctx.toolName} (provider=${ctx.providerType})`);
      const { AI_REVIEW_TASK_TYPE } = await import('../../oneshot/contract-registry.js');
      const command = (ctx.toolInput as { command?: string } | undefined)?.command || ctx.detail || '';
      const workspaceRoot = resolve(ctx.cwd || process.cwd());
      const candidateScripts = collectCandidateScripts(command, workspaceRoot).slice(0, MAX_REVIEW_FILES);
      const detailGuard = guardReviewText(ctx.detail);
      const inputGuard = guardReviewText(JSON.stringify(ctx.toolInput, null, 2).slice(0, 800));
      const runtimeResult = await ctx.oneShotRuntime.run<import('@my-claudia/shared/interaction/permissions').AIReviewResult>({
        taskType: AI_REVIEW_TASK_TYPE,
        providerType: ctx.providerType,
        prompt: buildInitialReviewPrompt(ctx, candidateScripts, detailGuard.text, inputGuard.text),
        cwd: workspaceRoot,
        cliPath: ctx.providerCliPath,
        env: ctx.providerEnv,
        systemPrompt: 'You are a machine-only security review helper for a coding assistant. Follow the user prompt exactly. Do not add markdown, commentary, prose, or code fences. Return only the JSON object requested by the prompt.',
        timeoutMs: 120000,
      });
      console.log(`[AI Review] Runtime result: ok=${runtimeResult.ok} stopReason=${runtimeResult.stopReason} fallback=${runtimeResult.usedFallback}`);

      if (runtimeResult.ok && runtimeResult.result) {
        llmResult = {
          decision: runtimeResult.result.decision,
          reasoning: runtimeResult.result.reasoning,
          confidence: runtimeResult.result.confidence,
          metadata: runtimeResult.result.metadata,
        };
      } else {
        // Runtime failed — fall back to legacy path
        console.log(`[AI Review] Runtime failed (${runtimeResult.stopReason}), falling back to analyzeLLMRisk`);
        llmResult = await analyzeLLMRisk(ctx);
      }
    } else {
      console.log(`[AI Review] Running LLM analysis for: ${ctx.toolName} (sessionId=${ctx.sessionId || 'new'})`);
      llmResult = await analyzeLLMRisk(ctx);
    }

    console.log(`[AI Review] LLM result: decision=${llmResult.decision} confidence=${llmResult.confidence} reasoning=${llmResult.reasoning?.slice(0, 100)}`);

    if (llmResult.confidence >= config.confidenceThreshold) {
      if (llmResult.decision === 'approve') recordApproval();
      return llmResult;
    }

    // Confidence too low → uncertain
    return {
      decision: 'uncertain',
      reasoning: `LLM confidence ${(llmResult.confidence * 100).toFixed(0)}% below threshold ${(config.confidenceThreshold * 100).toFixed(0)}%: ${llmResult.reasoning}`,
      confidence: llmResult.confidence,
      sessionId: llmResult.sessionId,
      metadata: llmResult.metadata,
    };
  } catch (err) {
    console.error(`[AI Review] LLM analysis failed:`, err);
    return {
      decision: 'uncertain',
      reasoning: 'AI review could not produce a reliable result; keeping this request pending for user review',
      confidence: 0,
    };
  }
}

/** Call LLM to analyze the risk of a tool call */
async function analyzeLLMRisk(ctx: AIReviewContext): Promise<AIReviewResultWithSession> {
  const command = (ctx.toolInput as { command?: string } | undefined)?.command || ctx.detail || '';
  const workspaceRoot = resolve(ctx.cwd || process.cwd());
  const candidateScripts = collectCandidateScripts(command, workspaceRoot).slice(0, MAX_REVIEW_FILES);
  const allowedFiles = new Map(candidateScripts.map((item) => [item.resolvedPath, item]));
  const reviewedFiles = new Set<string>();
  let totalBytesUsed = 0;
  const detailGuard = guardReviewText(ctx.detail);
  const inputGuard = guardReviewText(JSON.stringify(ctx.toolInput, null, 2).slice(0, 800));
  const payloadDisposition: ReviewPayloadDisposition =
    detailGuard.disposition === 'do_not_send' || inputGuard.disposition === 'do_not_send'
      ? 'do_not_send'
      : detailGuard.disposition === 'send_with_redaction' || inputGuard.disposition === 'send_with_redaction'
        ? 'send_with_redaction'
        : 'safe_to_send';
  const redactionCount = detailGuard.redactionCount + inputGuard.redactionCount;
  if (payloadDisposition === 'do_not_send') {
    return {
      decision: 'uncertain',
      reasoning: `Remote AI review skipped because the request payload may contain sensitive local material: ${[...detailGuard.reasons, ...inputGuard.reasons].join('; ')}`,
      confidence: 0,
      metadata: {
        payloadDisposition,
        redactionCount,
        reviewedFileCount: 0,
      } as ExtendedAIReviewMetadata,
    };
  }

  let reviewPrompt = buildInitialReviewPrompt(ctx, candidateScripts, detailGuard.text, inputGuard.text);
  let currentSessionId = ctx.sessionId;
  let attemptedFormatRepair = false;

  for (let turn = 0; turn < MAX_REVIEW_TURNS; turn += 1) {
    logAIReviewPayload('prompt', turn + 1, currentSessionId, reviewPrompt);
    const { response, sessionId: returnedSessionId } = await ctx.analysisProvider!.runPrompt(reviewPrompt, currentSessionId);
    currentSessionId = returnedSessionId || currentSessionId;
    logAIReviewPayload('response', turn + 1, currentSessionId, response);
    let parsed: AIReviewModelResponse;
    try {
      parsed = parseAIReviewResponse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      console.warn(
        `[AI Review] Invalid LLM response on turn ${turn + 1}/${MAX_REVIEW_TURNS}: ${errorMessage}; response=${summarizeAIReviewResponse(response)}`
      );
      appendAIReviewDebugLog(
        `kind=parse_error\nturn=${turn + 1}\nsessionId=${currentSessionId || 'new'}\nerror=${errorMessage}\nsummary=${summarizeAIReviewResponse(response)}`
      );
      if (!attemptedFormatRepair) {
        attemptedFormatRepair = true;
        reviewPrompt = buildRepairPrompt(response, errorMessage);
        continue;
      }
      throw error;
    }
    attemptedFormatRepair = false;

    if (parsed.type === 'final') {
      return {
        ...parsed,
        sessionId: currentSessionId,
        metadata: {
          payloadDisposition,
          redactionCount,
          reviewedFileCount: reviewedFiles.size,
        } as ExtendedAIReviewMetadata,
      };
    }

    const resolvedRequestedPath = isAbsolute(parsed.path)
      ? resolve(parsed.path)
      : resolve(workspaceRoot, parsed.path);

    if (reviewedFiles.has(resolvedRequestedPath)) {
      reviewPrompt = buildFileResultPrompt({
        ok: false,
        path: parsed.path,
        resolvedPath: resolvedRequestedPath,
        reason: 'That file was already provided for this review',
      });
      continue;
    }
    if (reviewedFiles.size >= MAX_REVIEW_FILES) {
      return {
        decision: 'uncertain',
        reasoning: 'AI review requested too many files',
        confidence: 0,
        sessionId: currentSessionId,
      };
    }

    const fileResult = await readReviewFile(parsed.path, workspaceRoot, allowedFiles, totalBytesUsed, command);
    if (fileResult.ok && fileResult.bytesReturned) {
      reviewedFiles.add(fileResult.resolvedPath!);
      totalBytesUsed += fileResult.bytesReturned;
    }
    reviewPrompt = buildFileResultPrompt(fileResult);
  }

  return {
    decision: 'uncertain',
    reasoning: 'AI review exceeded the maximum analysis turns',
    confidence: 0,
    sessionId: currentSessionId,
    metadata: {
      payloadDisposition,
      redactionCount,
      reviewedFileCount: reviewedFiles.size,
    } as ExtendedAIReviewMetadata,
  };
}

// ============================================
// @deprecated v2: Delegation evaluator — kept for backward compat
// ============================================

/** @deprecated Use evaluateAIReview instead. */
export async function evaluateDelegation(
  config: DelegationConfig,
  ctx: DelegationContext,
): Promise<DelegationDecision> {
  if (config.neverDelegate.includes(ctx.toolName)) {
    return { decision: 'escalate', reasoning: 'Tool is in neverDelegate list', confidence: 0, source: 'rule' };
  }

  const category = classify(ctx.toolName, ctx.toolInput, ctx.detail);
  if (!config.allowedCategories.includes(category)) {
    return { decision: 'escalate', reasoning: `Category "${category}" not in allowedCategories`, confidence: 0, source: 'rule' };
  }

  if (isRateLimited(config.maxAutoApprovalsPerMinute)) {
    return { decision: 'escalate', reasoning: 'Rate limit exceeded', confidence: 0, source: 'rule' };
  }

  const profile = ctx.policy.profile;
  const categoryAction = profile[category];
  if (categoryAction === 'auto-approve') {
    recordApproval();
    return { decision: 'approve', reasoning: `Category "${category}" is auto-approve for ${ctx.sessionType} sessions`, confidence: 1.0, source: 'rule' };
  }
  if (categoryAction === 'block') {
    return { decision: 'deny', reasoning: `Category "${category}" is blocked for ${ctx.sessionType} sessions`, confidence: 1.0, source: 'rule' };
  }

  if (ctx.analysisProvider) {
    try {
      const aiResult = await analyzeLLMRisk({
        ...ctx,
        analysisProvider: wrapLegacyProvider(ctx.analysisProvider),
      });
      const llmDecision: DelegationDecision = {
        decision: aiResult.decision === 'uncertain' ? 'escalate' : aiResult.decision,
        reasoning: aiResult.reasoning,
        confidence: aiResult.confidence,
        source: 'llm',
      };
      if (llmDecision.confidence >= config.confidenceThreshold) {
        if (llmDecision.decision === 'approve') recordApproval();
        return llmDecision;
      }
      return {
        decision: 'escalate',
        reasoning: `LLM confidence ${(llmDecision.confidence * 100).toFixed(0)}% below threshold ${(config.confidenceThreshold * 100).toFixed(0)}%: ${llmDecision.reasoning}`,
        confidence: llmDecision.confidence,
        source: 'llm',
      };
    } catch (err) {
      return {
        decision: 'escalate',
        reasoning: 'AI review could not produce a reliable result; escalating to the user',
        confidence: 0,
        source: 'llm',
      };
    }
  }

  return { decision: 'escalate', reasoning: 'No LLM provider for risk analysis', confidence: 0, source: 'rule' };
}
