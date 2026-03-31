import type { StepExecutorPort, StepResult, StepContext } from '../ports/step-executor.js';
import type { WorkflowNodeDef } from '@my-claudia/shared';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

export class ShellStepExecutor implements StepExecutorPort {
  readonly supportedTypes = ['shell'] as const;

  async execute(
    _node: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: StepContext,
  ): Promise<StepResult> {
    const command = config.command as string;
    if (!command) return { status: 'failed', output: {}, error: 'No command specified' };

    const cwd = (config.cwd as string) ?? ctx.projectRootPath ?? process.cwd();
    const timeout = (config.timeoutMs as number) ?? 60000;

    try {
      const { stdout, stderr } = await execFileAsync(
        '/bin/sh',
        ['-c', command],
        { cwd, timeout, maxBuffer: 1024 * 1024 },
      );
      return {
        status: 'completed',
        output: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 },
      };
    } catch (err: unknown) {
      const execErr = err as { code?: number; killed?: boolean; stdout?: string; stderr?: string; message?: string };
      if (execErr.code === undefined && execErr.killed) {
        return { status: 'failed', output: {}, error: 'Command timed out' };
      }
      return {
        status: 'failed',
        output: { stdout: execErr.stdout ?? '', stderr: execErr.stderr ?? '', exitCode: execErr.code ?? 1 },
        error: execErr.stderr || execErr.message,
      };
    }
  }
}
