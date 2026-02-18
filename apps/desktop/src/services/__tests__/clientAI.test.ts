import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getClientAIConfig,
  setClientAIConfig,
  clearClientAIConfig,
  isClientAIConfigured,
  streamChatCompletion,
  type ClientAIConfig,
  type ChatMessage,
} from '../clientAI';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('clientAI config persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no config saved', () => {
    expect(getClientAIConfig()).toBeNull();
  });

  it('saves and loads config', () => {
    const config: ClientAIConfig = {
      apiEndpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-test-123',
      model: 'gpt-4o',
    };
    setClientAIConfig(config);

    const loaded = getClientAIConfig();
    expect(loaded).toEqual(config);
  });

  it('clears config', () => {
    setClientAIConfig({ apiEndpoint: 'https://example.com', apiKey: 'key', model: 'model' });
    clearClientAIConfig();

    expect(getClientAIConfig()).toBeNull();
  });

  it('isClientAIConfigured returns false when not configured', () => {
    expect(isClientAIConfigured()).toBe(false);
  });

  it('isClientAIConfigured returns true when fully configured', () => {
    setClientAIConfig({
      apiEndpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    expect(isClientAIConfigured()).toBe(true);
  });

  it('isClientAIConfigured returns false when apiKey is empty', () => {
    setClientAIConfig({
      apiEndpoint: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o',
    });
    expect(isClientAIConfigured()).toBe(false);
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('my-claudia-client-ai-config', '{invalid json}');
    expect(getClientAIConfig()).toBeNull();
  });
});

describe('streamChatCompletion', () => {
  const config: ClientAIConfig = {
    apiEndpoint: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o',
  };

  const messages: ChatMessage[] = [
    { role: 'user', content: 'Hello' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

    const events = [];
    for await (const event of streamChatCompletion(config, messages)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].error).toContain('Network unreachable');
  });

  it('yields error on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    const events = [];
    for await (const event of streamChatCompletion(config, messages)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].error).toContain('401');
  });

  it('yields error when no response body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: null,
    });

    const events = [];
    for await (const event of streamChatCompletion(config, messages)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].error).toContain('No response body');
  });

  it('parses SSE content deltas', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    let readIndex = 0;
    const chunks = [encoder.encode(sseData)];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (readIndex < chunks.length) {
              return { done: false, value: chunks[readIndex++] };
            }
            return { done: true, value: undefined };
          },
          releaseLock: vi.fn(),
        }),
      },
    });

    const events = [];
    for await (const event of streamChatCompletion(config, messages)) {
      events.push(event);
    }

    const deltas = events.filter(e => e.type === 'delta');
    expect(deltas).toHaveLength(2);
    expect(deltas[0].content).toBe('Hello');
    expect(deltas[1].content).toBe(' world');
    expect(events.some(e => e.type === 'done')).toBe(true);
  });

  it('accumulates tool call deltas and emits on DONE', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"list_","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"backends","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const encoder = new TextEncoder();
    let readIndex = 0;
    const chunks = [encoder.encode(sseData)];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (readIndex < chunks.length) {
              return { done: false, value: chunks[readIndex++] };
            }
            return { done: true, value: undefined };
          },
          releaseLock: vi.fn(),
        }),
      },
    });

    const events = [];
    for await (const event of streamChatCompletion(config, messages)) {
      events.push(event);
    }

    const toolCalls = events.filter(e => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolCall?.function.name).toBe('list_backends');
    expect(toolCalls[0].toolCall?.function.arguments).toBe('{}');
    expect(toolCalls[0].toolCall?.id).toBe('call-1');
  });

  it('sends correct request URL and headers', async () => {
    mockFetch.mockRejectedValueOnce(new Error('test'));

    // Just consume the generator to trigger the fetch
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamChatCompletion(config, messages)) { /* noop */ }

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer sk-test',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('includes tools in request body when provided', async () => {
    mockFetch.mockRejectedValueOnce(new Error('test'));

    const tools = [{
      type: 'function' as const,
      function: { name: 'test_tool', description: 'Test', parameters: {} },
    }];

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamChatCompletion(config, messages, tools)) { /* noop */ }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe('auto');
  });

  it('strips trailing slash from apiEndpoint', async () => {
    const cfgWithSlash: ClientAIConfig = {
      apiEndpoint: 'https://api.openai.com/v1/',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    };

    mockFetch.mockRejectedValueOnce(new Error('test'));

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of streamChatCompletion(cfgWithSlash, messages)) { /* noop */ }

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
  });
});
