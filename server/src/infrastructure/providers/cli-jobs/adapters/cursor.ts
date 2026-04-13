import type { CliJobInput, CliJobRawResult, CliProviderAdapter } from '../types.js';

function buildPrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `[System Context]\n${systemPrompt}\n\n${prompt}`;
}

export const cursorReviewAdapter: CliProviderAdapter = {
  providerType: 'cursor',
  resolveBinary(input: CliJobInput): string {
    return input.cliPath || 'cursor-agent';
  },
  buildArgs(input: CliJobInput): string[] {
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--trust',
      '--workspace',
      input.cwd,
    ];

    if (input.model) {
      args.push('--model', input.model);
    }

    args.push(buildPrompt(input.prompt, input.systemPrompt));
    return args;
  },
  extractAssistantText(raw: CliJobRawResult): string {
    const assistantChunks: string[] = [];
    for (const line of raw.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === 'assistant') {
          const message = event.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
          for (const block of message?.content || []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              assistantChunks.push(block.text);
            }
          }
        } else if (event.type === 'thinking' && typeof event.text === 'string') {
          assistantChunks.push(event.text);
        }
      } catch {
        // Ignore malformed lines.
      }
    }
    return assistantChunks.join('\n');
  },
};
