/**
 * Plugin Provider API
 *
 * Provides plugins with access to AI providers for multi-model collaboration.
 * This API allows plugins to call different AI models in a unified way.
 *
 * Note: This is a simplified implementation that works with the existing
 * CLI-based provider infrastructure. For direct API calls, a more sophisticated
 * implementation would be needed.
 */

import type {
  ProviderAPI,
  ProviderInfo,
  ProviderCallOptions,
  ProviderCallResult,
  ProviderStreamChunk,
} from '@my-claudia/shared';
import { providerRegistry } from '../providers/registry.js';
import type { RunOptions } from '../providers/types.js';

// Re-export types for convenience
export type { ProviderCallOptions, ProviderCallResult, ProviderStreamChunk };

// ============================================
// Plugin Provider API Implementation
// ============================================

export class PluginProviderAPI implements ProviderAPI {
  private db: import('better-sqlite3').Database;
  private pluginId: string;

  constructor(db: import('better-sqlite3').Database, pluginId: string) {
    this.db = db;
    this.pluginId = pluginId;
  }

  /**
   * List available providers
   */
  async list(): Promise<ProviderInfo[]> {
    const providers = this.db
      .prepare(`
        SELECT id, name, type, is_default
        FROM providers
        ORDER BY is_default DESC, name ASC
      `)
      .all() as Array<{
        id: string;
        name: string;
        type: string;
        is_default: number;
      }>;

    return providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      models: this.getModelsForProvider(p.type),
      isDefault: p.is_default === 1,
    }));
  }

  /**
   * Get a specific provider by ID
   */
  async get(providerId: string): Promise<ProviderInfo | undefined> {
    const provider = this.db
      .prepare(`
        SELECT id, name, type, is_default
        FROM providers
        WHERE id = ?
      `)
      .get(providerId) as {
        id: string;
        name: string;
        type: string;
        is_default: number;
      } | undefined;

    if (!provider) return undefined;

    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      models: this.getModelsForProvider(provider.type),
      isDefault: provider.is_default === 1,
    };
  }

  /**
   * Call a provider with messages (non-streaming)
   *
   * This implementation uses the CLI-based providers. For multi-model collaboration,
   * the messages are combined into a single prompt.
   */
  async call(options: ProviderCallOptions): Promise<ProviderCallResult> {
    const { providerId, modelOverride, messages, systemPrompt, maxTokens, temperature } = options;

    // Get provider from database
    const providerRow = this.db
      .prepare(`
        SELECT id, name, type, cli_path, env
        FROM providers
        WHERE id = ?
      `)
      .get(providerId) as {
        id: string;
        name: string;
        type: string;
        cli_path: string | null;
        env: string | null;
      } | undefined;

    if (!providerRow) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    // Get the adapter for this provider type
    const adapter = providerRegistry.get(providerRow.type);
    if (!adapter) {
      throw new Error(`No adapter found for provider type: ${providerRow.type}`);
    }

    // Build the prompt from messages
    const prompt = this.buildPromptFromMessages(messages, systemPrompt);

    // Build run options
    const runOptions: RunOptions = {
      cwd: process.cwd(),
      cliPath: providerRow.cli_path || undefined,
      env: providerRow.env ? JSON.parse(providerRow.env) : undefined,
      model: modelOverride,
      systemPrompt,
    };

    // Collect all messages from the run
    const collectedMessages: Array<{ type: string; content?: string }> = [];
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      // Run the provider
      for await (const msg of adapter.run(prompt, runOptions, async () => {
        // Auto-allow supervision for plugin-initiated provider calls
        // TODO: Route through proper supervision chain for production use
        return { decision: 'allow', behavior: 'allow' } as any;
      })) {
        // Cast to access properties that may exist on different message types
        const m = msg as { type: string; content?: string; result?: string; usage?: { input_tokens?: number; output_tokens?: number } };
        if (m.type === 'assistant' && m.content) {
          collectedMessages.push({ type: 'assistant', content: m.content });
        } else if (m.type === 'result' && m.result) {
          collectedMessages.push({ type: 'result', content: m.result });
        }
        // Extract token usage if available
        if (m.usage) {
          if (m.usage.input_tokens) inputTokens += m.usage.input_tokens;
          if (m.usage.output_tokens) outputTokens += m.usage.output_tokens;
        }
      }
    } catch (error) {
      throw new Error(
        `Provider call failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Combine content
    const content = collectedMessages
      .filter((m) => m.content)
      .map((m) => m.content)
      .join('\n');

    // Parse metadata from response
    const metadata = this.parseResponseMetadata(content);

    return {
      content,
      model: modelOverride || this.getDefaultModel(providerRow.type),
      providerId,
      usage: {
        inputTokens,
        outputTokens,
      },
      metadata,
      isComplete: metadata?.isComplete as boolean | undefined,
      suggestedNextSteps: metadata?.suggestedNextSteps as string[] | undefined,
    };
  }

  /**
   * Call a provider with streaming response
   */
  async *callStream(options: ProviderCallOptions): AsyncGenerator<ProviderStreamChunk> {
    const { providerId, modelOverride, messages, systemPrompt } = options;

    // Get provider from database
    const providerRow = this.db
      .prepare(`
        SELECT id, name, type, cli_path, env
        FROM providers
        WHERE id = ?
      `)
      .get(providerId) as {
        id: string;
        name: string;
        type: string;
        cli_path: string | null;
        env: string | null;
      } | undefined;

    if (!providerRow) {
      yield { type: 'error', error: `Provider not found: ${providerId}` };
      return;
    }

    // Get the adapter for this provider type
    const adapter = providerRegistry.get(providerRow.type);
    if (!adapter) {
      yield { type: 'error', error: `No adapter found for provider type: ${providerRow.type}` };
      return;
    }

    // Build the prompt from messages
    const prompt = this.buildPromptFromMessages(messages, systemPrompt);

    // Build run options
    const runOptions: RunOptions = {
      cwd: process.cwd(),
      cliPath: providerRow.cli_path || undefined,
      env: providerRow.env ? JSON.parse(providerRow.env) : undefined,
      model: modelOverride,
      systemPrompt,
    };

    try {
      let fullContent = '';

      // Run the provider and stream messages
      for await (const msg of adapter.run(prompt, runOptions, async () => ({ decision: 'allow', behavior: 'allow' } as any))) {
        // Cast to access properties that may exist on different message types
        const m = msg as { type: string; content?: string; result?: string };
        if (m.type === 'assistant' && m.content) {
          const delta = m.content.substring(fullContent.length);
          fullContent = m.content;
          yield {
            type: 'content',
            delta,
            content: fullContent,
          };
        } else if (m.type === 'result' && m.result) {
          yield {
            type: 'content',
            content: m.result,
          };
        }
      }

      yield { type: 'done' };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Build a prompt from messages array
   */
  private buildPromptFromMessages(
    messages: Array<{ role: string; content: string }>,
    systemPrompt?: string
  ): string {
    const parts: string[] = [];

    if (systemPrompt) {
      parts.push(`[System Instructions]\n${systemPrompt}\n`);
    }

    for (const msg of messages) {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      parts.push(`[${roleLabel}]\n${msg.content}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Get available models for a provider type
   */
  private getModelsForProvider(type: string): string[] {
    const modelMap: Record<string, string[]> = {
      claude: [
        'claude-opus-4-6',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
      ],
      codex: ['o3', 'o4-mini', 'codex-1'],
      opencode: ['default'],
      cursor: ['default'],
    };
    return modelMap[type] || [];
  }

  /**
   * Get default model for a provider type
   */
  private getDefaultModel(type: string): string {
    const models = this.getModelsForProvider(type);
    return models[0] || 'default';
  }

  /**
   * Parse response metadata for multi-model collaboration
   */
  private parseResponseMetadata(content: string): Record<string, unknown> | undefined {
    // Try to extract completion status from the response
    const isCompleteMatch = content.match(
      /(?:是否还需要继续优化|needs further optimization|足够完善|sufficient)[：:]\s*(是|否|yes|no)/i
    );
    const scoreMatch = content.match(/(?:完整性|completeness|评分|score)[：:]\s*(\d+)/i);

    if (isCompleteMatch || scoreMatch) {
      return {
        isComplete:
          isCompleteMatch?.[1]?.toLowerCase() === '否' || isCompleteMatch?.[1]?.toLowerCase() === 'no',
        score: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
      };
    }

    return undefined;
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a Provider API instance for a plugin
 */
export function createProviderAPI(
  db: import('better-sqlite3').Database,
  pluginId: string
): ProviderAPI {
  return new PluginProviderAPI(db, pluginId);
}
