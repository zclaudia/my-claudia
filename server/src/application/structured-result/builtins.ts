import type { AIReviewResult } from '@my-claudia/shared/interaction/permissions';
import { parseFinalReviewFromText } from '../../infrastructure/providers/cli-jobs/review-parser.js';
import type { StructuredResultTypeEntry } from './types.js';
import type { StructuredResultRegistry } from './schema-registry.js';

export const AI_REVIEW_V1_RESULT_TYPE = 'ai_review_v1';

export const aiReviewV1Entry: StructuredResultTypeEntry<AIReviewResult> = {
  resultType: AI_REVIEW_V1_RESULT_TYPE,
  jsonSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['approve', 'deny', 'uncertain'] },
      reasoning: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['decision', 'reasoning', 'confidence'],
    additionalProperties: false,
  },
  fallbackPolicy: {
    strategy: 'text_json_parse',
    parser: (text: string) => parseFinalReviewFromText(text, 'Structured result fallback'),
  },
};

export function registerBuiltInStructuredResults(registry: StructuredResultRegistry): void {
  registry.register(aiReviewV1Entry);
}
