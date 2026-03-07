import type { ProviderAdapter } from './types.js';
import { ClaudeAdapter } from './claude-adapter.js';
import { OpenCodeAdapter } from './opencode-adapter.js';
import { CodexAdapter } from './codex-adapter.js';
import { CursorAdapter } from './cursor-adapter.js';
import { KimiAdapter } from './kimi-adapter.js';

class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private defaultType = 'claude';

  constructor() {
    this.register(new ClaudeAdapter());
    this.register(new OpenCodeAdapter());
    this.register(new CodexAdapter());
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
}

export const providerRegistry = new ProviderRegistry();
