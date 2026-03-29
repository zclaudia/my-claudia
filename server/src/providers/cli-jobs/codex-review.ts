import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';
import { sanitizeInheritedProviderEnv } from '../../utils/startup-env.js';

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

export async function runCodexReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  const binary = input.cliPath || 'codex';
  const tempDir = mkdtempSync(join(tmpdir(), 'my-claudia-codex-review-'));
  const schemaPath = join(tempDir, 'schema.json');
  const outputPath = join(tempDir, 'last-message.txt');
  writeFileSync(schemaPath, REVIEW_SCHEMA);

  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--json',
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath,
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

  const baseEnv = { ...process.env, ...(input.env || {}) } as Record<string, string>;
  sanitizeInheritedProviderEnv(baseEnv);
  const env = baseEnv;

  return await new Promise<AIReviewCliJobResult>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let spawnError: Error | null = null;

    const proc = spawn(binary, args, {
      cwd: input.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const cleanup = (): void => {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    };

    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const settleResolve = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      try {
        const outputText = readFileSync(outputPath, 'utf-8');
        const parsed = parseFinalReviewFromText(outputText, 'Codex review job');
        cleanup();
        resolve({
          ...parsed,
          rawStdout: stdoutBuffer,
          rawStderr: stderrBuffer,
          exitCode,
        });
      } catch (error) {
        try {
          const fallbackSource = stdoutBuffer || stderrBuffer;
          const parsed = parseFinalReviewFromText(fallbackSource, 'Codex review job');
          cleanup();
          resolve({
            ...parsed,
            rawStdout: stdoutBuffer,
            rawStderr: stderrBuffer,
            exitCode,
          });
        } catch (fallbackError) {
          cleanup();
          reject(buildCliReviewParseError('Codex review job', stdoutBuffer, stderrBuffer, fallbackError ?? error));
        }
      }
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
      timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        settleReject(new Error(`Codex review job timed out after ${input.timeoutMs}ms`));
      }, input.timeoutMs);
    }

    proc.on('error', (error) => {
      spawnError = error;
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    proc.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (spawnError) {
        settleReject(spawnError);
        return;
      }
      settleResolve(code);
    });
  });
}
