/**
 * Client-side OpenAI-compatible API client.
 *
 * Used by the mobile global agent to call AI APIs directly from the client
 * (no backend server needed). Supports streaming SSE and function/tool calling.
 */

// ============================================
// Types
// ============================================

export interface ClientAIConfig {
  apiEndpoint: string;  // e.g. "https://api.openai.com/v1"
  apiKey: string;
  model: string;        // e.g. "gpt-4o", "claude-sonnet-4-5-20250929"
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;  // For role=tool responses
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface StreamEvent {
  type: 'delta' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

// ============================================
// Config persistence (localStorage)
// ============================================

const STORAGE_KEY = 'my-claudia-client-ai-config';

export function getClientAIConfig(): ClientAIConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ClientAIConfig;
  } catch {
    return null;
  }
}

export function setClientAIConfig(config: ClientAIConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearClientAIConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isClientAIConfigured(): boolean {
  const config = getClientAIConfig();
  return !!(config?.apiEndpoint && config?.apiKey && config?.model);
}

// ============================================
// Streaming chat completion
// ============================================

/**
 * Call the OpenAI-compatible chat completions API with streaming.
 * Yields StreamEvent objects as they arrive.
 */
export async function* streamChatCompletion(
  config: ClientAIConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const url = `${config.apiEndpoint.replace(/\/$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    yield { type: 'error', error: `Network error: ${error instanceof Error ? error.message : String(error)}` };
    return;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    yield { type: 'error', error: `API error ${response.status}: ${errorText}` };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: 'error', error: 'No response body' };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  const toolCalls: Map<number, ToolCall> = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') {
          if (trimmed === 'data: [DONE]') {
            // Emit accumulated tool calls
            for (const tc of toolCalls.values()) {
              yield { type: 'tool_call', toolCall: tc };
            }
            toolCalls.clear();
            yield { type: 'done' };
          }
          continue;
        }

        if (!trimmed.startsWith('data: ')) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          const choice = data.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // Content delta
          if (delta.content) {
            yield { type: 'delta', content: delta.content };
          }

          // Tool call deltas (accumulated across chunks)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const existing = toolCalls.get(idx);
              if (tc.id) {
                // New tool call
                toolCalls.set(idx, {
                  id: tc.id,
                  type: 'function',
                  function: {
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                  },
                });
              } else if (existing) {
                // Append to existing
                if (tc.function?.name) {
                  existing.function.name += tc.function.name;
                }
                if (tc.function?.arguments) {
                  existing.function.arguments += tc.function.arguments;
                }
              }
            }
          }

          // Usage info (sometimes in the last chunk)
          if (data.usage) {
            yield {
              type: 'done',
              usage: {
                input_tokens: data.usage.prompt_tokens || 0,
                output_tokens: data.usage.completion_tokens || 0,
              },
            };
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }

    // If we exit the loop without [DONE], still emit accumulated tool calls
    if (toolCalls.size > 0) {
      for (const tc of toolCalls.values()) {
        yield { type: 'tool_call', toolCall: tc };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
