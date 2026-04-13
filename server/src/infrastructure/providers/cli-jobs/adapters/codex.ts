import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  CliAdapterPreparedContext,
  CliJobInput,
  CliJobRawResult,
  CliProviderAdapter,
} from '../types.js';

const REVIEW_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    type: { type: 'string', const: 'final' },
    decision: { type: 'string', enum: ['approve', 'deny', 'uncertain'] },
    reasoning: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['type', 'decision', 'reasoning', 'confidence'],
  additionalProperties: false,
}, null, 2);

interface CodexPreparedContext extends CliAdapterPreparedContext {
  tempDir: string;
  schemaPath: string;
  outputPath: string;
}

export const codexReviewAdapter: CliProviderAdapter = {
  providerType: 'codex',
  resolveBinary(input: CliJobInput): string {
    return input.cliPath || 'codex';
  },
  prepare(): CodexPreparedContext {
    const tempDir = mkdtempSync(join(tmpdir(), 'my-claudia-codex-review-'));
    const schemaPath = join(tempDir, 'schema.json');
    const outputPath = join(tempDir, 'last-message.txt');
    writeFileSync(schemaPath, REVIEW_SCHEMA);
    return { tempDir, schemaPath, outputPath };
  },
  buildArgs(input: CliJobInput, ctx?: CliAdapterPreparedContext): string[] {
    const codexCtx = ctx as CodexPreparedContext | undefined;
    if (!codexCtx) {
      throw new Error('Codex review adapter requires prepared context');
    }

    const args = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--json',
      '--output-schema',
      codexCtx.schemaPath,
      '--output-last-message',
      codexCtx.outputPath,
      '--cd',
      input.cwd,
    ];

    if (input.model) {
      args.push('--model', input.model);
    }

    const prompt = input.systemPrompt
      ? `[System Context]\n${input.systemPrompt}\n\n${input.prompt}`
      : input.prompt;
    args.push(prompt);
    return args;
  },
  extractAssistantText(raw: CliJobRawResult, ctx?: CliAdapterPreparedContext): string {
    const codexCtx = ctx as CodexPreparedContext | undefined;
    if (codexCtx) {
      try {
        return readFileSync(codexCtx.outputPath, 'utf-8');
      } catch {
        // Fall back below.
      }
    }
    return raw.stdout || raw.stderr;
  },
  cleanup(ctx?: CliAdapterPreparedContext): void {
    const codexCtx = ctx as CodexPreparedContext | undefined;
    if (!codexCtx) return;
    try {
      rmSync(codexCtx.tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  },
};
