import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { parseFinalReviewFromText } from './review-parser.js';
import { sanitizeInheritedProviderEnv } from '../../utils/startup-env.js';

function buildPrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `[System Context]\n${systemPrompt}\n\n${prompt}`;
}

export async function runCursorReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  const binary = input.cliPath || 'cursor-agent';
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

  const baseEnv = { ...process.env, ...(input.env || {}) } as Record<string, string>;
  sanitizeInheritedProviderEnv(baseEnv);
  const env = baseEnv;

  return await new Promise<AIReviewCliJobResult>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let spawnError: Error | null = null;
    const assistantChunks: string[] = [];

    const proc = spawn(binary, args, {
      cwd: input.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const settleResolve = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      try {
        const parsed = parseFinalReviewFromText(assistantChunks.join('\n'), 'Cursor review job');
        resolve({
          ...parsed,
          rawStdout: stdoutBuffer,
          rawStderr: stderrBuffer,
          exitCode,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
      timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        settleReject(new Error(`Cursor review job timed out after ${input.timeoutMs}ms`));
      }, input.timeoutMs);
    }

    proc.on('error', (error) => {
      spawnError = error;
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    if (!proc.stdout) {
      if (timeout) clearTimeout(timeout);
      settleReject(spawnError || new Error('Cursor review job stdout is unavailable'));
      return;
    }

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    const readLoop = (async () => {
      try {
        for await (const line of rl) {
          if (!line.trim()) continue;
          stdoutBuffer += `${line}\n`;
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
      } catch (error) {
        if (timeout) clearTimeout(timeout);
        settleReject(error instanceof Error ? error : new Error(String(error)));
      }
    })();

    proc.on('close', async (code) => {
      if (timeout) clearTimeout(timeout);
      await readLoop;
      rl.close();
      if (spawnError) {
        settleReject(spawnError);
        return;
      }
      settleResolve(code);
    });
  });
}
