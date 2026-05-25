import type { PCPProviderManifest } from '@my-claudia/shared/core/pcp';
import type { ProviderPolicy } from '@my-claudia/shared/core/provider-policy';
import type { ProviderDefinition } from './definitions.js';
import type { ProviderAdapter } from './types.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { OpenClaudeAdapter } from './openclaude-adapter.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { CodexAppServerAdapter } from './codex-app-server-adapter.js';
import { CursorAdapter } from './cursor-adapter.js';
import { KimiAdapter } from './kimi-adapter.js';
import { ACPProviderAdapter } from './acp-adapter.js';

/** Port interface — conversation domain depends on this, not on the concrete registry. */
export interface ProviderRegistryPort {
  get(type: string): ProviderAdapter | undefined;
  getOrDefault(type: string): ProviderAdapter;
  getPolicy(type: string): ProviderPolicy | undefined;
  getDefinition(type: string): ProviderDefinition | undefined;
}

class ProviderRegistry implements ProviderRegistryPort {
  private adapters = new Map<string, ProviderAdapter>();
  private defaultType = 'claude';

  constructor() {
    this.register(new ClaudeAdapter());
    this.register(new OpenClaudeAdapter());
    this.register(new OpenCodeAdapter());
    this.register(new CodexAppServerAdapter());
    this.register(new CursorAdapter());
    this.register(new KimiAdapter());
    this.register(new ACPProviderAdapter());
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): ProviderAdapter | undefined {
    return this.adapters.get(type);
  }

  getOrDefault(type: string): ProviderAdapter {
    return this.adapters.get(type) || this.adapters.get(this.defaultType)!;
  }

  /** Get PCP manifest for a provider */
  getManifest(type: string): PCPProviderManifest | undefined {
    return this.adapters.get(type)?.manifest;
  }

  /** Get MyClaudia runtime policy for a provider */
  getPolicy(type: string): ProviderPolicy | undefined {
    return this.adapters.get(type)?.policy;
  }

  /** Get the composed provider definition used by the runtime. */
  getDefinition(type: string): ProviderDefinition | undefined {
    const adapter = this.adapters.get(type);
    if (!adapter?.manifest) return undefined;
    return {
      adapter,
      capabilityManifest: adapter.manifest,
      policy: adapter.policy ?? {},
      normalizer: adapter.normalizer,
    };
  }

  /** Get all registered PCP manifests */
  getAllManifests(): PCPProviderManifest[] {
    return Array.from(this.adapters.values())
      .map(a => a.manifest)
      .filter((m): m is PCPProviderManifest => !!m);
  }
}

export const providerRegistry = new ProviderRegistry();
