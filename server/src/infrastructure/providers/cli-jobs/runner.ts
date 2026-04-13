import { spawn } from 'child_process';
import { sanitizeInheritedProviderEnv } from '../../../utils/startup-env.js';
import type {
  CliAdapterPreparedContext,
  CliJobInput,
  CliJobRawResult,
  CliProviderAdapter,
} from './types.js';
import {
  CliJobExtractionError,
  CliJobParseError,
  CliJobSpawnError,
  CliJobTimeoutError,
} from './types.js';

function buildCliEnv(input: CliJobInput): Record<string, string> {
  const baseEnv = { ...process.env, ...(input.env || {}) } as Record<string, string>;
  sanitizeInheritedProviderEnv(baseEnv);
  return baseEnv;
}

export async function runCliJob<T>(
  adapter: CliProviderAdapter,
  input: CliJobInput,
  parseResult: (assistantText: string, raw: CliJobRawResult, ctx?: CliAdapterPreparedContext) => T,
): Promise<T> {
  let prepared: CliAdapterPreparedContext | undefined;
  if (adapter.prepare) {
    const maybePrepared = adapter.prepare(input);
    prepared = maybePrepared instanceof Promise ? await maybePrepared : maybePrepared;
  }
  const ctx = prepared;
  const start = Date.now();
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let timedOut = false;

  const cleanup = async (): Promise<void> => {
    await adapter.cleanup?.(ctx);
  };

  try {
    const binary = adapter.resolveBinary(input);
    const args = adapter.buildArgs(input, ctx);
    const env = buildCliEnv(input);

    const raw = await new Promise<CliJobRawResult>((resolve, reject) => {
      let spawnError: Error | null = null;
      let settled = false;

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
        resolve({
          exitCode,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
          timedOut,
          durationMs: Date.now() - start,
        });
      };

      let timeout: ReturnType<typeof setTimeout> | undefined;
      if (typeof input.timeoutMs === 'number' && input.timeoutMs > 0) {
        timeout = setTimeout(() => {
          timedOut = true;
          proc.kill('SIGTERM');
          settleReject(new CliJobTimeoutError(`${adapter.providerType} review job timed out after ${input.timeoutMs}ms`));
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

      proc.on('close', async (code) => {
        if (timeout) clearTimeout(timeout);
        await new Promise<void>((resolveNext) => setImmediate(resolveNext));
        if (spawnError) {
          settleReject(new CliJobSpawnError(spawnError.message, spawnError));
          return;
        }
        settleResolve(code);
      });
    });

    let assistantText: string;
    try {
      assistantText = adapter.extractAssistantText(raw, ctx);
    } catch (error) {
      throw new CliJobExtractionError(
        error instanceof Error ? error.message : String(error),
        error,
      );
    }

    try {
      return parseResult(assistantText, raw, ctx);
    } catch (error) {
      throw new CliJobParseError(
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  } finally {
    try {
      await cleanup();
    } catch (cleanupErr) {
      console.error(`[CliJob] Cleanup error for ${adapter.providerType}:`, cleanupErr);
    }
  }
}
