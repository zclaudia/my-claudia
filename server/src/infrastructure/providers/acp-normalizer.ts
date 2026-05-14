import type { ProviderEventNormalizer } from './provider-normalizer.js';

export const ACP_NORMALIZER: ProviderEventNormalizer = {
  normalizeToolUse(event) {
    if (event.toolName === 'ACPPlan') {
      return {
        toolSemantic: 'plan_proposal',
      };
    }
    return {};
  },
};
