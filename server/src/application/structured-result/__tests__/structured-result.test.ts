import { describe, expect, it } from 'vitest';
import type { AIReviewResult } from '@my-claudia/shared/interaction/permissions';
import { applyFallbackPolicy } from '../fallback.js';
import {
  AI_REVIEW_V1_RESULT_TYPE,
  aiReviewV1Entry,
  registerBuiltInStructuredResults,
} from '../builtins.js';
import {
  createSubmitStructuredResultTool,
  executeSubmitStructuredResult,
  SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
} from '../finalization-tool.js';
import { StructuredResultRegistry } from '../schema-registry.js';
import { validateStructuredResultSubmission } from '../validator.js';

describe('structured-result', () => {
  it('registers built-in result types', () => {
    const registry = new StructuredResultRegistry();
    registerBuiltInStructuredResults(registry);

    expect(registry.has(AI_REVIEW_V1_RESULT_TYPE)).toBe(true);
    expect(registry.get(AI_REVIEW_V1_RESULT_TYPE)?.resultType).toBe(AI_REVIEW_V1_RESULT_TYPE);
  });

  it('rejects duplicate registration', () => {
    const registry = new StructuredResultRegistry();
    registry.register(aiReviewV1Entry);
    expect(() => registry.register(aiReviewV1Entry)).toThrow('already registered');
  });

  it('validates a correct ai_review_v1 submission', () => {
    const registry = new StructuredResultRegistry();
    registry.register(aiReviewV1Entry);

    const result = validateStructuredResultSubmission<AIReviewResult>(registry, {
      resultType: AI_REVIEW_V1_RESULT_TYPE,
      payload: {
        decision: 'approve',
        reasoning: 'Safe',
        confidence: 0.9,
      },
    });

    expect(result).toMatchObject({
      accepted: true,
      resultType: AI_REVIEW_V1_RESULT_TYPE,
    });
  });

  it('returns stable validation errors for invalid payloads', () => {
    const registry = new StructuredResultRegistry();
    registry.register(aiReviewV1Entry);

    const result = validateStructuredResultSubmission(registry, {
      resultType: AI_REVIEW_V1_RESULT_TYPE,
      payload: {
        decision: 'safe',
        reasoning: 'Safe',
        confidence: 2,
      },
    });

    expect(result.accepted).toBe(false);
    expect(result).toMatchObject({
      code: 'schema_validation_failed',
      message: 'payload.decision must be one of: approve, deny, uncertain',
    });
  });

  it('creates the finalization tool definition', () => {
    const tool = createSubmitStructuredResultTool();
    expect(tool.name).toBe(SUBMIT_STRUCTURED_RESULT_TOOL_NAME);
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      required: ['result_type', 'payload'],
    });
  });

  it('accepts a valid structured result submission', () => {
    const registry = new StructuredResultRegistry();
    registry.register(aiReviewV1Entry);

    const runContext = {
      finalized: false,
      validationFailures: 0,
    };

    const result = executeSubmitStructuredResult(registry, runContext, {
      resultType: AI_REVIEW_V1_RESULT_TYPE,
      payload: {
        decision: 'deny',
        reasoning: 'Dangerous',
        confidence: 0.98,
      },
    });

    expect(result.finalized).toBe(true);
    expect(runContext.finalized).toBe(true);
    expect(runContext.acceptedResult).toMatchObject({
      resultType: AI_REVIEW_V1_RESULT_TYPE,
      payload: { decision: 'deny' },
    });
  });

  it('returns an error tool result for invalid structured submissions', () => {
    const registry = new StructuredResultRegistry();
    registry.register(aiReviewV1Entry);

    const runContext = {
      finalized: false,
      validationFailures: 0,
    };

    const result = executeSubmitStructuredResult(registry, runContext, {
      resultType: AI_REVIEW_V1_RESULT_TYPE,
      payload: {
        decision: 'safe',
        reasoning: 'Dangerous',
        confidence: 0.98,
      },
    });

    expect(result.finalized).toBe(false);
    expect(result.toolResult.isError).toBe(true);
    expect(runContext.validationFailures).toBe(1);
    expect(runContext.finalized).toBe(false);
  });

  it('applies text_json_parse fallback using the built-in parser', () => {
    const outcome = applyFallbackPolicy(aiReviewV1Entry.fallbackPolicy, '{"type":"final","decision":"approve","reasoning":"ok","confidence":0.8}');
    expect(outcome.source).toBe('fallback_text_json');
    expect(outcome.result).toMatchObject({
      decision: 'approve',
      confidence: 0.8,
    });
  });
});
