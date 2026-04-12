import { spawn } from 'child_process';
import type { AIReviewCliJobResult, CliJobInput } from './types.js';
import { buildCliReviewParseError, parseFinalReviewFromText } from './review-parser.js';
import { sanitizeInheritedProviderEnv } from '../../../utils/startup-env.js';

export async function runClaudeReviewJob(input: CliJobInput): Promise<AIReviewCliJobResult> {
  const binary = input.cliPath || 'claude';
  const args = [
    '--print',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--permission-mode',
    'bypassPermissions',
    '--tools',
    '',
  ];

  if (input.model) {
    args.push('--model', input.model);
  }

  if (input.systemPrompt) {
    args.push('--system-prompt', input.systemPrompt);
  }

  args.push(input.prompt);

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

    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const settleResolve = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      let sourceText = stdoutBuffer;
      try {
        try {
          const parsedStdout = JSON.parse(stdoutBuffer) as Record<string, unknown>;
          if (typeof parsedStdout.result === 'string' && parsedStdout.result.length > 0) {
            sourceText = parsedStdout.result;
          }
        } catch {
          // Fall back to raw stdout parsing.
        }
        const parsed = parseFinalReviewFromText(sourceText, 'Claude review job');
        resolve({
          ...parsed,
          rawStdout: stdoutBuffer,
          rawStderr: stderrBuffer,
          exitCode,
        });
      } catch (error) {
        reject(buildCliReviewParseError('Claude review job', stdoutBuffer, stderrBuffer, error, sourceText));
      }
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
      timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        settleReject(new Error(`Claude review job timed out after ${input.timeoutMs}ms`));
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

    const stdoutEnded = new Promise<void>((resolveEnd) => {
      proc.stdout?.on('end', () => resolveEnd());
      if (!proc.stdout) resolveEnd();
    });

    proc.on('close', async (code) => {
      if (timeout) clearTimeout(timeout);
      await stdoutEnded;
      if (spawnError) {
        settleReject(spawnError);
        return;
      }
      settleResolve(code);
    });
  });
}
