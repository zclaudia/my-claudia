import type { ProviderAdapter } from './types.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { OpenCodeAdapter } from './opencode-adapter.js';

class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private defaultType = 'claude';

  constructor() {
    this.register(new ClaudeAdapter());
    this.register(new OpenCodeAdapter());
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
}

export const providerRegistry = new ProviderRegistry();
