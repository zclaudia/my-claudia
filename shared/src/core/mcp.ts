// MCP Server Types

import type { ProviderType } from './provider.js';

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  description?: string;
  providerScope?: ProviderType[];
  source: 'user' | 'imported';
  createdAt: number;
  updatedAt: number;
}
