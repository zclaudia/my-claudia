import type { FallbackPolicy, StructuredResultFallbackOutcome } from './types.js';

export function applyFallbackPolicy<T>(
  policy: FallbackPolicy<T>,
  text: string,
): StructuredResultFallbackOutcome<T> {
  switch (policy.strategy) {
    case 'text_json_parse':
      if (!policy.parser) {
        return {
          source: 'fallback_fail',
          error: 'Fallback parser is not configured',
        };
      }
      try {
        return {
          source: 'fallback_text_json',
          result: policy.parser(text),
        };
      } catch (err) {
        return {
          source: 'fallback_fail',
          error: `Fallback parser threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    case 'mark_uncertain':
      if (!policy.createUncertain) {
        return {
          source: 'fallback_uncertain',
          error: 'Fallback uncertain result factory is not configured',
        };
      }
      try {
        return {
          source: 'fallback_uncertain',
          result: policy.createUncertain(),
        };
      } catch (err) {
        return {
          source: 'fallback_fail',
          error: `Fallback uncertain factory threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    case 'fail':
    default:
      return {
        source: 'fallback_fail',
        error: 'Fallback policy requested failure',
      };
  }
}
