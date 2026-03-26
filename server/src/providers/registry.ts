import type { PCPProviderManifest } from '@my-claudia/shared';
import type { ProviderAdapter } from './types.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { CodexAppServerAdapter } from './codex-app-server-adapter.js';
import { CursorAdapter } from './cursor-adapter.js';
import { KimiAdapter } from './kimi-adapter.js';

class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private defaultType = 'claude';

  constructor() {
    this.register(new ClaudeAdapter());
    this.register(new OpenCodeAdapter());
    this.register(new CodexAppServerAdapter());
    this.register(new CursorAdapter());
    this.register(new KimiAdapter());
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

  /** Get all registered PCP manifests */
  getAllManifests(): PCPProviderManifest[] {
    return Array.from(this.adapters.values())
      .map(a => a.manifest)
      .filter((m): m is PCPProviderManifest => !!m);
  }
}

export const providerRegistry = new ProviderRegistry();
