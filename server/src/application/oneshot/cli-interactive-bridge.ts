/**
 * Interactive Bridge — wraps an AIReviewProvider (multi-turn prompt/response)
 * into the OneShotTaskProviderBridge interface.
 *
 * Unlike CliBatchBridge which runs a single CLI invocation, this bridge
 * supports multi-turn conversations where the model can request file reads
 * and submit structured results through the prompt/response loop.
 *
 * Each response is checked for:
 * 1. A structured result submission ({result_type, payload}) → validated via onToolCall
 * 2. Other tool calls (read_file etc.) → handled by the caller-provided toolHandler
 * 3. A "final" text response → returned as rawText for fallback parsing
 */

import type { ToolDefinition } from '../structured-result/types.js';
import type {
  OneShotTaskProviderBridge,
  ProviderBridgeRequest,
  ProviderBridgeResult,
  ToolCall,
} from './types.js';
import { SUBMIT_STRUCTURED_RESULT_TOOL_NAME } from '../structured-result/finalization-tool.js';
import { extractJSONObjects } from '../../infrastructure/providers/cli-jobs/json-extract.js';

const MAX_TURNS = 8;

export interface InteractivePromptProvider {
  runPrompt(prompt: string, sessionId?: string): Promise<{ response: string; sessionId?: string }>;
}

/** Tool handler for non-submit tool calls (e.g. read_file). */
export type InteractiveToolHandler = (
  call: ToolCall,
) => Promise<{ nextPrompt: string } | { done: true; rawText: string }>;

export interface CliInteractiveBridgeOptions {
  providerType: string;
  promptProvider: InteractivePromptProvider;
  /** Handles non-submit tool calls (read_file, etc.). If not provided, all tool calls are ignored. */
  toolHandler?: InteractiveToolHandler;
}

export class CliInteractiveBridge implements OneShotTaskProviderBridge {
  readonly providerType: string;
  private promptProvider: InteractivePromptProvider;
  private toolHandler?: InteractiveToolHandler;

  constructor(options: CliInteractiveBridgeOptions) {
    this.providerType = options.providerType;
    this.promptProvider = options.promptProvider;
    this.toolHandler = options.toolHandler;
  }

  async run(request: ProviderBridgeRequest): Promise<ProviderBridgeResult> {
    const startMs = Date.now();
    const schemaHint = buildInteractiveSchemaHint(request.finalTool);

    let prompt = request.systemPrompt
      ? `${request.systemPrompt}\n\n${schemaHint}\n\n${request.prompt}`
      : `${schemaHint}\n\n${request.prompt}`;

    let sessionId: string | undefined;
    let lastRawText = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const { response, sessionId: returnedSessionId } = await this.promptProvider.runPrompt(prompt, sessionId);
      sessionId = returnedSessionId || sessionId;
      lastRawText = response;

      // 1. Check for submit_structured_result in response
      const submitCall = extractSubmitCall(response);
      if (submitCall && request.onToolCall) {
        const outcome = await request.onToolCall(submitCall);
        if (outcome.finalized) {
          // Structured result accepted — return immediately
          return {
            rawText: response,
            durationMs: Date.now() - startMs,
          };
        }
        // Validation failed — ask model to fix
        prompt = buildValidationErrorPrompt(outcome.toolResult.content);
        continue;
      }

      // 2. Check for other tool calls (read_file etc.)
      const toolCall = extractToolCall(response);
      if (toolCall && this.toolHandler) {
        const handlerResult = await this.toolHandler(toolCall);
        if ('done' in handlerResult) {
          return {
            rawText: handlerResult.rawText,
            durationMs: Date.now() - startMs,
          };
        }
        prompt = handlerResult.nextPrompt;
        continue;
      }

      // 3. No tool calls detected — this is likely the final text response
      // Return it for the runtime to attempt structured extraction + fallback
      return {
        rawText: response,
        durationMs: Date.now() - startMs,
      };
    }

    // Max turns exceeded
    return {
      rawText: lastRawText,
      timedOut: true,
      durationMs: Date.now() - startMs,
    };
  }
}

function buildInteractiveSchemaHint(finalTool: ToolDefinition): string {
  return [
    'When you are ready to submit your final review decision, output a JSON object matching this schema:',
    JSON.stringify(finalTool.inputSchema, null, 2),
    'The JSON must contain "result_type" (string) and "payload" (object with decision, reasoning, confidence).',
    '',
    'If you need to read a file before deciding, output: {"type":"read_file","path":"relative/path","reason":"why"}',
    '',
    'Rules: No markdown, no code fences, no extra text. Return ONLY the JSON object.',
  ].join('\n');
}

/**
 * Try to extract a submit_structured_result tool call from the response.
 * Looks for JSON with {result_type, payload} structure.
 */
function extractSubmitCall(response: string): ToolCall | null {
  const candidates = extractJSONObjects(response);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]) as Record<string, unknown>;
      if (typeof parsed.result_type === 'string' && typeof parsed.payload === 'object' && parsed.payload !== null) {
        return {
          name: SUBMIT_STRUCTURED_RESULT_TOOL_NAME,
          arguments: parsed,
        };
      }
    } catch {
      // skip
    }
  }
  return null;
}

/**
 * Try to extract a non-submit tool call (e.g. read_file) from the response.
 */
function extractToolCall(response: string): ToolCall | null {
  const candidates = extractJSONObjects(response);
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(candidates[i]) as Record<string, unknown>;
      if (parsed.type === 'read_file' && typeof parsed.path === 'string') {
        return {
          name: 'read_file',
          arguments: parsed,
        };
      }
    } catch {
      // skip
    }
  }
  return null;
}

function buildValidationErrorPrompt(errorContent: string): string {
  return `Your structured result submission was invalid:

${errorContent}

Please fix the issues and resubmit. Output ONLY the corrected JSON object with "result_type" and "payload".`;
}
