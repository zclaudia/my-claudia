import type { StructuredResultRegistry } from '../structured-result/schema-registry.js';
import type { StructuredResultRunContext } from '../structured-result/types.js';
import { createSubmitStructuredResultTool } from '../structured-result/finalization-tool.js';
import { applyFallbackPolicy } from '../structured-result/fallback.js';
import { validateStructuredResultSubmission } from '../structured-result/validator.js';
import { extractJSONObjects } from '../../infrastructure/providers/cli-jobs/json-extract.js';
import { CliJobTimeoutError } from '../../infrastructure/providers/cli-jobs/types.js';
import type {
  OneShotTaskRuntime,
  OneShotTaskRequest,
  OneShotTaskResult,
  OneShotTaskProviderBridge,
  OneShotTaskContractRegistry,
  OneShotTaskContract,
  OneShotStopReason,
  OneShotTaskTelemetry,
} from './types.js';

export interface OneShotTaskRuntimeDeps {
  bridges: Map<string, OneShotTaskProviderBridge>;
  contractRegistry: OneShotTaskContractRegistry;
  structuredResultRegistry: StructuredResultRegistry;
}

export class DefaultOneShotTaskRuntime implements OneShotTaskRuntime {
  constructor(private readonly deps: OneShotTaskRuntimeDeps) {}

  async run<T = unknown>(request: OneShotTaskRequest<T>): Promise<OneShotTaskResult<T>> {
    const startMs = Date.now();

    // 1. Resolve contract
    const contract = this.deps.contractRegistry.get<T>(request.taskType);
    if (!contract) {
      throw new Error(`Unknown task type "${request.taskType}". Registered: ${this.deps.contractRegistry.list().join(', ') || '(none)'}`);
    }

    // 2. Apply contractOverride (only fallbackPolicyOverride + maxValidationFailures)
    const effectiveContract: OneShotTaskContract<T> = { ...contract };
    if (request.contractOverride?.maxValidationFailures !== undefined) {
      effectiveContract.maxValidationFailures = request.contractOverride.maxValidationFailures;
    }
    if (request.contractOverride?.fallbackPolicyOverride !== undefined) {
      effectiveContract.fallbackPolicyOverride = request.contractOverride.fallbackPolicyOverride;
    }

    // 3. Resolve structured result entry
    const entry = this.deps.structuredResultRegistry.get<T>(effectiveContract.resultType);
    if (!entry) {
      throw new Error(`Unknown result type "${effectiveContract.resultType}" referenced by contract "${request.taskType}"`);
    }

    // 4. Create finalTool + runContext
    const finalTool = createSubmitStructuredResultTool();
    const runContext: StructuredResultRunContext<T> = {
      finalized: false,
      validationFailures: 0,
    };

    // 5. Resolve bridge
    const bridge = this.deps.bridges.get(request.providerType);
    if (!bridge) {
      throw new Error(`No bridge registered for provider "${request.providerType}". Available: ${[...this.deps.bridges.keys()].join(', ') || '(none)'}`);
    }

    // 6. Execute bridge
    let rawText = '';
    let exitCode: number | null | undefined;
    let stopReason: OneShotStopReason = 'fallback_fail';

    try {
      const bridgeResult = await bridge.run({
        prompt: request.prompt,
        cwd: request.cwd,
        cliPath: request.cliPath,
        env: request.env,
        systemPrompt: request.systemPrompt,
        model: request.model,
        mode: request.mode,
        timeoutMs: request.timeoutMs,
        finalTool,
      });

      rawText = bridgeResult.rawText;
      exitCode = bridgeResult.exitCode;

      if (bridgeResult.timedOut) {
        stopReason = 'timeout';
      } else {
        // 7. Try structured extraction from rawText (batch mode)
        const extracted = this.tryExtractStructuredResult(rawText, runContext, effectiveContract.resultType);
        stopReason = extracted;
      }
    } catch (err) {
      if (err instanceof CliJobTimeoutError) {
        stopReason = 'timeout';
      } else {
        stopReason = 'provider_error';
        console.error(`[OneShotRuntime] Bridge error for ${request.taskType}/${request.providerType}:`, err);
      }
    }

    // 8. If finalized via structured submit, return success
    if (runContext.finalized && runContext.acceptedResult) {
      return this.buildResult(true, runContext.acceptedResult.payload, rawText, false, 'structured_submit', {
        taskType: request.taskType,
        providerType: request.providerType,
        resultType: effectiveContract.resultType,
        durationMs: Date.now() - startMs,
        validationFailures: runContext.validationFailures,
        finalized: true,
        usedFallback: false,
        toolSubmissionAttempts: runContext.validationFailures + 1,
        rawExitCode: exitCode ?? null,
      });
    }

    // 9. Apply fallback
    const fallbackPolicy = effectiveContract.fallbackPolicyOverride ?? entry.fallbackPolicy;
    const fallbackOutcome = applyFallbackPolicy(fallbackPolicy, rawText);

    const telemetry: OneShotTaskTelemetry = {
      taskType: request.taskType,
      providerType: request.providerType,
      resultType: effectiveContract.resultType,
      durationMs: Date.now() - startMs,
      validationFailures: runContext.validationFailures,
      finalized: false,
      usedFallback: fallbackOutcome.result !== undefined,
      toolSubmissionAttempts: runContext.validationFailures,
      rawExitCode: exitCode ?? null,
    };

    if (fallbackOutcome.result !== undefined) {
      const effectiveStopReason = stopReason === 'timeout' ? 'timeout' : 'fallback';
      return this.buildResult(true, fallbackOutcome.result, rawText, true, effectiveStopReason, telemetry);
    }

    // 10. Everything failed
    return this.buildResult<T>(false, undefined as T | undefined, rawText, false, stopReason, {
      ...telemetry,
      usedFallback: false,
    });
  }

  /**
   * Scan rawText for JSON objects matching {result_type, payload} structure.
   * Uses extractJSONObjects() for robust multi-JSON handling.
   * Iterates candidates in reverse order (last JSON is most likely the final answer).
   */
  private tryExtractStructuredResult<T>(
    rawText: string,
    runContext: StructuredResultRunContext<T>,
    expectedResultType: string,
  ): OneShotStopReason {
    const jsonCandidates = extractJSONObjects(rawText);

    // Iterate in reverse — last JSON block is most likely the final answer
    for (let i = jsonCandidates.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(jsonCandidates[i]) as Record<string, unknown>;
        if (typeof parsed.result_type !== 'string' || typeof parsed.payload !== 'object' || parsed.payload === null) {
          continue;
        }

        const validation = validateStructuredResultSubmission<T>(
          this.deps.structuredResultRegistry,
          { resultType: parsed.result_type as string, payload: parsed.payload as Record<string, unknown> },
        );
        if (validation.accepted) {
          runContext.acceptedResult = { resultType: validation.resultType, payload: validation.payload };
          runContext.finalized = true;
          return 'structured_submit';
        }
        runContext.validationFailures += 1;
      } catch {
        // JSON parse failure on this candidate; try next
      }
    }

    // Also try: the entire output might be a direct payload (without result_type wrapper)
    for (let i = jsonCandidates.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(jsonCandidates[i]) as Record<string, unknown>;
        // Skip if it looks like a wrapper (already tried above)
        if ('result_type' in parsed) continue;

        const validation = validateStructuredResultSubmission<T>(
          this.deps.structuredResultRegistry,
          { resultType: expectedResultType, payload: parsed },
        );
        if (validation.accepted) {
          runContext.acceptedResult = { resultType: validation.resultType, payload: validation.payload };
          runContext.finalized = true;
          return 'structured_submit';
        }
      } catch {
        // skip
      }
    }

    return 'fallback_fail';
  }

  private buildResult<T>(
    ok: boolean,
    result: T | undefined,
    rawText: string,
    usedFallback: boolean,
    stopReason: OneShotStopReason,
    telemetry: OneShotTaskTelemetry,
  ): OneShotTaskResult<T> {
    return { ok, result, rawText, usedFallback, stopReason, telemetry };
  }
}
