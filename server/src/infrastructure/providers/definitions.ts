import type { ProviderPolicy } from '@my-claudia/shared/core/provider-policy';
import type { PCPProviderManifest } from '@my-claudia/shared/core/pcp';
import type { ProviderAdapter } from './types.js';
import type { ProviderEventNormalizer } from './provider-normalizer.js';
export type { ProviderEventNormalizer } from './provider-normalizer.js';

export interface ProviderDefinition {
  adapter: ProviderAdapter;
  capabilityManifest: PCPProviderManifest;
  policy: ProviderPolicy;
  normalizer?: ProviderEventNormalizer;
}
