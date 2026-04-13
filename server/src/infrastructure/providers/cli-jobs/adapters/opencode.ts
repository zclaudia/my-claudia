import type { CliJobInput, CliJobRawResult, CliProviderAdapter } from '../types.js';

function buildPrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `[System Context]\n${systemPrompt}\n\n${prompt}`;
}

export const opencodeReviewAdapter: CliProviderAdapter = {
  providerType: 'opencode',
  resolveBinary(input: CliJobInput): string {
    return input.cliPath || 'opencode';
  },
  buildArgs(input: CliJobInput): string[] {
    const args = ['run', '--format', 'json', '--dir', input.cwd];
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
        const text = typeof event.content === 'string'
          ? event.content
          : typeof event.text === 'string'
            ? event.text
            : typeof event.message === 'string'
              ? event.message
              : event.part && typeof event.part === 'object' && typeof (event.part as Record<string, unknown>).text === 'string'
                ? String((event.part as Record<string, unknown>).text)
                : undefined;
        if (text) assistantChunks.push(text);
      } catch {
        // Ignore malformed lines.
      }
    }

    if (
      raw.exitCode !== 0
      && !raw.stdout.trim()
      && raw.stderr.includes('agent')
      && raw.stderr.includes('not found')
    ) {
      throw new Error(
        `OpenCode review failed: agent not found. ${raw.stderr.split('\n')[0].replace(/\x1b\[[0-9;]*m/g, '').trim()}. ` +
        'Check your OpenCode agent configuration (opencode agent list).'
      );
    }

    return assistantChunks.join('\n') || raw.stdout;
  },
};
