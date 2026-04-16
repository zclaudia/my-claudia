import type { CliProviderAdapter, CliJobRawResult, CliAdapterPreparedContext } from '../../infrastructure/providers/cli-jobs/types.js';
import { runCliJob } from '../../infrastructure/providers/cli-jobs/runner.js';
import type { OneShotTaskProviderBridge, ProviderBridgeRequest, ProviderBridgeResult } from './types.js';
import type { ToolDefinition } from '../structured-result/types.js';

/**
 * Batch-mode bridge: wraps a CliProviderAdapter + runCliJob() into the
 * OneShotTaskProviderBridge interface.
 *
 * For batch mode, the submit_structured_result schema is injected into
 * the system prompt. The provider CLI runs to completion and the runtime
 * handles structured extraction + fallback from the raw output.
 */
export class CliBatchBridge implements OneShotTaskProviderBridge {
  readonly providerType: string;

  constructor(private readonly adapter: CliProviderAdapter) {
    this.providerType = adapter.providerType;
  }

  async run(request: ProviderBridgeRequest): Promise<ProviderBridgeResult> {
    const schemaHint = buildSchemaPromptHint(request.finalTool);
    const augmentedSystemPrompt = request.systemPrompt
      ? `${request.systemPrompt}\n\n${schemaHint}`
      : schemaHint;

    const input = {
      prompt: request.prompt,
      cwd: request.cwd,
      cliPath: request.cliPath,
      env: request.env,
      systemPrompt: augmentedSystemPrompt,
      model: request.model,
      timeoutMs: request.timeoutMs,
    };

    return runCliJob(
      this.adapter,
      input,
      (assistantText: string, raw: CliJobRawResult, _ctx?: CliAdapterPreparedContext): ProviderBridgeResult => ({
        rawText: assistantText,
        exitCode: raw.exitCode,
        timedOut: raw.timedOut,
        durationMs: raw.durationMs,
      }),
    );
  }
}

function buildSchemaPromptHint(finalTool: ToolDefinition): string {
  return [
    `You have a tool called "${finalTool.name}": ${finalTool.description}`,
    'When you are ready to submit your final answer, output a JSON object matching this schema:',
    JSON.stringify(finalTool.inputSchema, null, 2),
    'The JSON must contain "result_type" (string) and "payload" (object matching the schema above).',
  ].join('\n');
}
