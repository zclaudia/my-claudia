/**
 * Client-side agent loop — Meta-Agent for MyClaudia.
 *
 * Manages the conversation lifecycle:
 * 1. Send user message to OpenAI-compatible API with tool definitions
 * 2. Stream response, execute tool calls via high-level agentTools
 * 3. Loop until no more tool calls (max iterations capped)
 * 4. Persist messages to IndexedDB
 */

import type { ChatMessage, ClientAIConfig, ToolCall } from './clientAI';
import { streamChatCompletion, getClientAIConfig } from './clientAI';
import { getAgentTools, executeToolCall, type ToolExecutionContext } from './agentTools';
import { loadMessages, saveMessages, clearMessages } from './agentStorage';

const MAX_TOOL_ITERATIONS = 10;

const AGENT_SYSTEM_PROMPT = `You are the Meta-Agent for MyClaudia. You help users manage and orchestrate their AI coding sessions.

You can:
- Browse and manage projects, sessions, and providers
- Search and summarize conversation history across sessions
- Read project files
- Work across multiple connected backends

Keep responses concise — you run in a side panel with limited space.
For destructive operations (delete, archive), confirm with the user first.
When multiple backends exist, clarify which one if ambiguous.`;

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
  toolContext?: ToolExecutionContext,
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
    await runAgentLoop(config, callbacks, toolContext);
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
  toolContext?: ToolExecutionContext,
): Promise<void> {
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    callbacks.onAssistantStart();

    // Build full message array with system prompt
    const fullMessages: ChatMessage[] = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      ...conversationMessages,
    ];

    // Stream the response
    let fullContent = '';
    const pendingToolCalls: ToolCall[] = [];

    for await (const event of streamChatCompletion(
      config,
      fullMessages,
      getAgentTools(),
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
      const result = await executeToolCall(toolCall, toolContext);
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
