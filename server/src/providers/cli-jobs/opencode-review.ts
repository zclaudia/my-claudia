import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';
import { sanitizeInheritedProviderEnv } from '../../utils/startup-env.js';

function buildPrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `[System Context]\n${systemPrompt}\n\n${prompt}`;
}

export async function runOpenCodeReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  const binary = input.cliPath || 'opencode';
  const args = ['run', '--format', 'json', '--dir', input.cwd];

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
        const sourceText = assistantChunks.join('\n') || stdoutBuffer;
        const parsed = parseFinalReviewFromText(sourceText, 'OpenCode review job');
        resolve({
          ...parsed,
          rawStdout: stdoutBuffer,
          rawStderr: stderrBuffer,
          exitCode,
        });
      } catch (error) {
        reject(buildCliReviewParseError('OpenCode review job', stdoutBuffer, stderrBuffer, error));
      }
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
      timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        settleReject(new Error(`OpenCode review job timed out after ${input.timeoutMs}ms`));
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
      settleReject(spawnError || new Error('OpenCode review job stdout is unavailable'));
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
