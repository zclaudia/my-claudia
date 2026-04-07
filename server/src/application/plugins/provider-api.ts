/**
 * Plugin Provider API
 *
 * Provides plugins with access to AI providers for multi-model collaboration.
 */

import type {
  ProviderAPI,
  ProviderInfo,
  ProviderCallOptions,
  ProviderCallResult,
  ProviderStreamChunk,
} from '@my-claudia/shared/plugin-types';
import { providerRegistry } from '../../infrastructure/providers/registry.js';
import type { RunOptions } from '../../infrastructure/providers/types.js';

export type { ProviderCallOptions, ProviderCallResult, ProviderStreamChunk };

export class PluginProviderAPI implements ProviderAPI {
  constructor(
    private db: import('better-sqlite3').Database,
    private pluginId: string,
  ) {}

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

    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      models: this.getModelsForProvider(provider.type),
      isDefault: provider.is_default === 1,
    }));
  }

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

    if (!provider) {
      return undefined;
    }

    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      models: this.getModelsForProvider(provider.type),
      isDefault: provider.is_default === 1,
    };
  }

  async call(options: ProviderCallOptions): Promise<ProviderCallResult> {
    const { providerId, modelOverride, messages, systemPrompt } = options;

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

    const adapter = providerRegistry.get(providerRow.type);
    if (!adapter) {
      throw new Error(`No adapter found for provider type: ${providerRow.type}`);
    }

    const prompt = this.buildPromptFromMessages(messages, systemPrompt);
    const runOptions: RunOptions = {
      cwd: process.cwd(),
      cliPath: providerRow.cli_path || undefined,
      env: providerRow.env ? JSON.parse(providerRow.env) : undefined,
      model: modelOverride,
      mode: 'plan',
      systemPrompt,
    };

    const collectedMessages: Array<{ type: string; content?: string }> = [];
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const msg of adapter.run(prompt, runOptions, async () => {
        return { behavior: 'deny' } as any;
      })) {
        const message = msg as {
          type: string;
          content?: string;
          result?: string;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        if (message.type === 'assistant' && message.content) {
          collectedMessages.push({ type: 'assistant', content: message.content });
        } else if (message.type === 'result' && message.result) {
          collectedMessages.push({ type: 'result', content: message.result });
        }
        if (message.usage) {
          if (message.usage.input_tokens) inputTokens += message.usage.input_tokens;
          if (message.usage.output_tokens) outputTokens += message.usage.output_tokens;
        }
      }
    } catch (error) {
      throw new Error(
        `Provider call failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const content = collectedMessages
      .filter((message) => message.content)
      .map((message) => message.content)
      .join('\n');

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

  async *callStream(options: ProviderCallOptions): AsyncGenerator<ProviderStreamChunk> {
    const { providerId, modelOverride, messages, systemPrompt } = options;

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

    const adapter = providerRegistry.get(providerRow.type);
    if (!adapter) {
      yield { type: 'error', error: `No adapter found for provider type: ${providerRow.type}` };
      return;
    }

    const prompt = this.buildPromptFromMessages(messages, systemPrompt);
    const runOptions: RunOptions = {
      cwd: process.cwd(),
      cliPath: providerRow.cli_path || undefined,
      env: providerRow.env ? JSON.parse(providerRow.env) : undefined,
      model: modelOverride,
      mode: 'plan',
      systemPrompt,
    };

    try {
      let fullContent = '';

      for await (const msg of adapter.run(prompt, runOptions, async () => ({ behavior: 'deny' } as any))) {
        const message = msg as { type: string; content?: string; result?: string };
        if (message.type === 'assistant' && message.content) {
          const delta = message.content.substring(fullContent.length);
          fullContent = message.content;
          yield {
            type: 'content',
            delta,
            content: fullContent,
          };
        } else if (message.type === 'result' && message.result) {
          yield {
            type: 'content',
            content: message.result,
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

  private getModelsForProvider(type: string): string[] {
    const modelMap: Record<string, string[]> = {
      claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
      codex: ['o3', 'o4-mini', 'codex-1'],
      opencode: ['default'],
      cursor: ['default'],
      kimi: ['default'],
    };
    return modelMap[type] || [];
  }

  private getDefaultModel(type: string): string {
    const models = this.getModelsForProvider(type);
    return models[0] || 'default';
  }

  private parseResponseMetadata(content: string): Record<string, unknown> | undefined {
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

export function createProviderAPI(
  db: import('better-sqlite3').Database,
  pluginId: string
): ProviderAPI {
  return new PluginProviderAPI(db, pluginId);
}
