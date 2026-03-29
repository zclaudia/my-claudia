import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';
import { sanitizeInheritedProviderEnv } from '../../utils/startup-env.js';

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
      if (typeof record.text === 'string') {
        chunks.push(record.text);
      }
      if (typeof record.think === 'string') {
        chunks.push(record.think);
      }
      if (typeof record.content === 'string') {
        chunks.push(record.content);
      }
    }
  }

  return chunks;
}

export async function runKimiReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  const binary = input.cliPath || 'kimi';
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

  const baseEnv = { ...process.env, ...(input.env || {}) } as Record<string, string>;
  sanitizeInheritedProviderEnv(baseEnv);
  const env = baseEnv;

  return await new Promise<AIReviewCliJobResult>((resolve, reject) => {
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    const assistantChunks: string[] = [];
    let spawnError: Error | null = null;

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
        const parsed = parseFinalReviewFromText(assistantChunks.join('\n'), 'Kimi review job');
        resolve({
          ...parsed,
          rawStdout: stdoutBuffer,
          rawStderr: stderrBuffer,
          exitCode,
        });
      } catch (error) {
        reject(buildCliReviewParseError('Kimi review job', stdoutBuffer, stderrBuffer, error));
      }
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
      timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        settleReject(new Error(`Kimi review job timed out after ${input.timeoutMs}ms`));
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
      settleReject(spawnError || new Error('Kimi review job stdout is unavailable'));
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
            const role = typeof event.role === 'string' ? event.role : undefined;
            if (event.type === 'assistant' || role === 'assistant') {
              assistantChunks.push(...collectKimiTextChunks(event));
            }
          } catch {
            // Ignore non-JSON lines for the structured job runner.
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
