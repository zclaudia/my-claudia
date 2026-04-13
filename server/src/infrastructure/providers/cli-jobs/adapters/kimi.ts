import type { CliJobInput, CliJobRawResult, CliProviderAdapter } from '../types.js';

function buildPrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `[System Context]\n${systemPrompt}\n\n${prompt}`;
}

function collectKimiTextChunks(event: Record<string, unknown>): string[] {
  const chunks: string[] = [];

  if (typeof event.content === 'string') {
    chunks.push(event.content);
  }

  if (Array.isArray(event.content)) {
    for (const part of event.content) {
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') chunks.push(record.text);
      if (typeof record.think === 'string') chunks.push(record.think);
      if (typeof record.content === 'string') chunks.push(record.content);
    }
  }

  return chunks;
}

export const kimiReviewAdapter: CliProviderAdapter = {
  providerType: 'kimi',
  resolveBinary(input: CliJobInput): string {
    return input.cliPath || 'kimi';
  },
  buildArgs(input: CliJobInput): string[] {
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--prompt',
      buildPrompt(input.prompt, input.systemPrompt),
      '--yolo',
      '--work-dir',
      input.cwd,
    ];

    if (input.model) {
      args.push('--model', input.model);
    }

    return args;
  },
  extractAssistantText(raw: CliJobRawResult): string {
    const assistantChunks: string[] = [];
    for (const line of raw.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const role = typeof event.role === 'string' ? event.role : undefined;
        if (event.type === 'assistant' || role === 'assistant') {
          assistantChunks.push(...collectKimiTextChunks(event));
        }
      } catch {
        // Ignore malformed lines.
      }
    }
    return assistantChunks.join('\n');
  },
};
