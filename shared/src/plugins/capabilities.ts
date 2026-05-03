/** MCP server requirement */
export interface McpRequirement {
  /** MCP server name (e.g., "DevHelper") */
  server: string;
  /** Specific tools needed from this server (optional — if omitted, any tool set is acceptable) */
  tools?: string[];
  /** If true, plugin cannot activate without this MCP server. Default: true */
  required?: boolean;
}

/** Provider (AI) requirement */
export interface ProviderRequirement {
  /** If true, plugin needs at least one AI provider available. Default: false */
  required?: boolean;
}

export interface PluginRequirements {
  /** Required MCP servers and their tools */
  mcp?: McpRequirement[];
  /** Required plugins */
  plugins?: Array<{ id: string; required?: boolean }>;
  /** AI provider requirements */
  providers?: ProviderRequirement;
}

export interface McpCapabilityStatus {
  server: string;
  available: boolean;
  /** Tools that were requested and found */
  availableTools?: string[];
  /** Tools that were requested but NOT found */
  missingTools?: string[];
  error?: string;
}

export interface CapabilityNegotiationResult {
  /** Overall: all required capabilities satisfied? */
  satisfied: boolean;
  /** Per-MCP-server status */
  mcp: Record<string, McpCapabilityStatus>;
  /** Per-plugin dependency status */
  plugins: Record<string, { available: boolean }>;
  /** Provider availability */
  providers: { available: boolean };
  /** Human-readable reasons for any failures */
  unsatisfiedReasons: string[];
}
