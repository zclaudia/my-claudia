import type { ProviderPolicy } from '@my-claudia/shared/core/provider-policy';
import type { PCPProviderManifest } from '@my-claudia/shared/core/pcp';
import type { ProviderAdapter } from './types.js';

export interface ProviderEventNormalizer {
  // Placeholder for the next migration phase. The runtime still consumes the
  // existing provider messages while policy and capability boundaries settle.
}

export interface ProviderDefinition {
  adapter: ProviderAdapter;
  capabilityManifest: PCPProviderManifest;
  policy: ProviderPolicy;
  normalizer?: ProviderEventNormalizer;
}
