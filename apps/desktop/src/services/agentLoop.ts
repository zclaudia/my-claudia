/**
 * Client-side agent loop for the mobile global agent.
 *
 * Manages the conversation lifecycle:
 * 1. Build system prompt with dynamic backend context
 * 2. Send user message to OpenAI-compatible API
 * 3. Stream response, execute tool calls
 * 4. Loop until no more tool calls
 * 5. Persist messages to IndexedDB
 */

import type { ChatMessage, ClientAIConfig, ToolCall } from './clientAI';
import { streamChatCompletion, getClientAIConfig } from './clientAI';
import { AGENT_TOOLS, executeToolCall } from './agentTools';
import { loadMessages, saveMessages, clearMessages } from './agentStorage';
import { buildAgentContext } from './agentContext';

const MAX_TOOL_ITERATIONS = 10;

const AGENT_SYSTEM_PROMPT = `You are the Agent Assistant for MyClaudia, an AI-powered development environment manager.
Your role is to help the user manage their projects, sessions, providers, and read session data across connected backend servers.

You have access to tools to interact with the backends:
- list_backends: See all connected backends
- call_api: Call any REST API endpoint on any backend

API endpoints available on each backend:
- GET /api/projects — List projects
- GET /api/projects/:id — Get project details
- POST /api/projects — Create project
- PUT /api/projects/:id — Update project
- DELETE /api/projects/:id — Delete project
- GET /api/sessions — List sessions (?projectId=...)
- GET /api/sessions/:id — Get session details
- POST /api/sessions — Create session
- DELETE /api/sessions/:id — Delete session
- GET /api/sessions/:id/messages?limit=50 — Get messages
- GET /api/sessions/:id/export — Export as Markdown
- GET /api/sessions/search/messages?q=keyword — Search messages
- GET /api/providers — List providers
- POST /api/providers — Create provider
- DELETE /api/providers/:id — Delete provider
- GET /api/supervisions — List supervisions
- POST /api/supervisions — Create supervision
- GET /api/files/list?projectRoot=/path&relativePath=src — List directory
- GET /api/files/content?projectRoot=/path&relativePath=file.ts — Read file
- GET /api/agent/config — Get agent config
- PUT /api/agent/config — Update agent config

Guidelines:
- Keep responses concise.
- For destructive operations (DELETE), confirm with the user first.
- When multiple backends exist, clarify which one if ambiguous.
- Use list_backends first if you need to know available backends.`;

// ============================================
// Agent Loop Callbacks
// ============================================

export interface AgentLoopCallbacks {
  /** Called when a content delta arrives (for streaming display) */
  onDelta: (content: string) => void;
  /** Called when the assistant's turn starts */
  onAssistantStart: () => void;
  /** Called when a tool call begins */
  onToolCallStart: (toolName: string, args: string) => void;
  /** Called when a tool call completes */
  onToolCallResult: (toolName: string, result: string) => void;
  /** Called when the full response is complete */
  onComplete: (fullContent: string) => void;
  /** Called on error */
  onError: (error: string) => void;
}

// ============================================
// Agent Loop State
// ============================================

let conversationMessages: ChatMessage[] = [];
let abortController: AbortController | null = null;
let isRunning = false;

/**
 * Initialize the agent loop — load messages from IndexedDB.
 */
export async function initAgentLoop(): Promise<ChatMessage[]> {
  conversationMessages = await loadMessages();
  return conversationMessages;
}

/**
 * Get current conversation messages (excluding system prompt).
 */
export function getMessages(): ChatMessage[] {
  return conversationMessages;
}

/**
 * Check if the agent loop is currently running.
 */
export function isAgentRunning(): boolean {
  return isRunning;
}

/**
 * Cancel the currently running agent loop.
 */
export function cancelAgentLoop(): void {
  abortController?.abort();
  abortController = null;
  isRunning = false;
}

/**
 * Clear conversation history.
 */
export async function clearConversation(): Promise<void> {
  conversationMessages = [];
  await clearMessages();
}

/**
 * Send a user message and run the agent loop.
 */
export async function sendMessage(
  userInput: string,
  callbacks: AgentLoopCallbacks,
): Promise<void> {
  const config = getClientAIConfig();
  if (!config) {
    callbacks.onError('Client AI not configured. Go to Settings to set up API key and endpoint.');
    return;
  }

  if (isRunning) {
    callbacks.onError('Agent is already running.');
    return;
  }

  isRunning = true;
  abortController = new AbortController();

  // Add user message
  conversationMessages.push({ role: 'user', content: userInput });

  try {
    await runAgentLoop(config, callbacks);
  } finally {
    isRunning = false;
    abortController = null;
    // Persist after each complete turn
    await saveMessages(conversationMessages);
  }
}

// ============================================
// Internal agent loop
// ============================================

async function runAgentLoop(
  config: ClientAIConfig,
  callbacks: AgentLoopCallbacks,
): Promise<void> {
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    callbacks.onAssistantStart();

    // Build full message array with system prompt
    const systemPrompt = `${buildAgentContext()}\n\n${AGENT_SYSTEM_PROMPT}`;
    const fullMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationMessages,
    ];

    // Stream the response
    let fullContent = '';
    const pendingToolCalls: ToolCall[] = [];

    for await (const event of streamChatCompletion(
      config,
      fullMessages,
      AGENT_TOOLS,
      abortController?.signal,
    )) {
      switch (event.type) {
        case 'delta':
          if (event.content) {
            fullContent += event.content;
            callbacks.onDelta(event.content);
          }
          break;

        case 'tool_call':
          if (event.toolCall) {
            pendingToolCalls.push(event.toolCall);
          }
          break;

        case 'error':
          callbacks.onError(event.error || 'Unknown error');
          return;

        case 'done':
          break;
      }
    }

    // If no tool calls, we're done
    if (pendingToolCalls.length === 0) {
      if (fullContent) {
        conversationMessages.push({ role: 'assistant', content: fullContent });
      }
      callbacks.onComplete(fullContent);
      return;
    }

    // Add assistant message with tool calls
    conversationMessages.push({
      role: 'assistant',
      content: fullContent || null,
      tool_calls: pendingToolCalls,
    });

    // Execute tool calls and add results
    for (const toolCall of pendingToolCalls) {
      callbacks.onToolCallStart(toolCall.function.name, toolCall.function.arguments);
      const result = await executeToolCall(toolCall);
      callbacks.onToolCallResult(toolCall.function.name, result);

      conversationMessages.push({
        role: 'tool',
        content: result,
        tool_call_id: toolCall.id,
      });
    }

    // Loop back for the next iteration (AI processes tool results)
  }

  callbacks.onError(`Agent reached maximum iterations (${MAX_TOOL_ITERATIONS}).`);
}
