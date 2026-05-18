// server/src/domains/meta-workflow/gate-runner.ts
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type {
  AcceptanceGate,
  MetaWorkflowGateResult,
} from '@my-claudia/shared/features/meta-workflow';

export interface RunGatesOptions {
  stopOnFirstFailure?: boolean;
}

export async function runGate(gate: AcceptanceGate, cwd: string): Promise<MetaWorkflowGateResult> {
  const effectiveCwd = gate.cwd ? join(cwd, gate.cwd) : cwd;
  const start = Date.now();

  const { stdout, stderr, exitCode, timedOut } = await execShell(gate.command, effectiveCwd, gate.expect.durationMaxMs);
  const durationMs = Date.now() - start;

  const expectedExit = gate.expect.exitCode ?? 0;
  let passed = !timedOut && exitCode === expectedExit;

  if (passed && gate.expect.stdoutMatches) {
    passed = new RegExp(gate.expect.stdoutMatches).test(stdout);
  }
  if (passed && gate.expect.stderrMatches) {
    passed = new RegExp(gate.expect.stderrMatches).test(stderr);
  }
  if (passed && gate.expect.fileExists) {
    for (const rel of gate.expect.fileExists) {
      const p = isAbsolute(rel) ? rel : join(effectiveCwd, rel);
      if (!existsSync(p)) { passed = false; break; }
    }
  }
  if (passed && gate.expect.fileNotExists) {
    for (const rel of gate.expect.fileNotExists) {
      const p = isAbsolute(rel) ? rel : join(effectiveCwd, rel);
      if (existsSync(p)) { passed = false; break; }
    }
  }

  return {
    gateId: gate.id,
    passed,
    stdout,
    stderr,
    exitCode,
    durationMs,
  };
}

export async function runGates(
  gates: AcceptanceGate[],
  cwd: string,
  opts: RunGatesOptions = {},
): Promise<MetaWorkflowGateResult[]> {
  const results: MetaWorkflowGateResult[] = [];
  for (const gate of gates) {
    const result = await runGate(gate, cwd);
    results.push(result);
    if (!result.passed && opts.stopOnFirstFailure) break;
  }
  return results;
}

function execShell(
  command: string,
  cwd: string,
  timeoutMs?: number,
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs) : null;

    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString(); });
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1, timedOut });
    });
  });
}
