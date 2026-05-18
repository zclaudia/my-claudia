// server/src/domains/meta-workflow/__tests__/gate-runner.test.ts
import { describe, it, expect } from 'vitest';
import { runGate, runGates } from '../gate-runner.js';
import type { AcceptanceGate } from '@my-claudia/shared/features/meta-workflow';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'gate-runner-'));
}

describe('gate runner', () => {
  it('passes when exit code matches', async () => {
    const gate: AcceptanceGate = {
      id: 'echo', description: 'echo ok', command: 'echo hello', expect: { exitCode: 0 },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/hello/);
  });

  it('fails when exit code does not match', async () => {
    const gate: AcceptanceGate = {
      id: 'fail', description: 'exit 1', command: 'exit 1', expect: { exitCode: 0 },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('checks stdoutMatches regex', async () => {
    const gate: AcceptanceGate = {
      id: 'm', description: 'm', command: 'echo SUCCESS-42',
      expect: { exitCode: 0, stdoutMatches: 'SUCCESS-\\d+' },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(true);
  });

  it('fails when stdoutMatches does not match', async () => {
    const gate: AcceptanceGate = {
      id: 'm', description: 'm', command: 'echo something',
      expect: { exitCode: 0, stdoutMatches: 'NOPE' },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(false);
  });

  it('checks fileExists', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'created.txt'), 'x');
    const gate: AcceptanceGate = {
      id: 'fe', description: 'file exists', command: 'true',
      expect: { exitCode: 0, fileExists: ['created.txt'] },
    };
    const result = await runGate(gate, dir);
    expect(result.passed).toBe(true);
  });

  it('checks fileNotExists', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'should-be-gone.txt'), 'x');
    const gate: AcceptanceGate = {
      id: 'fne', description: 'file is gone', command: 'true',
      expect: { exitCode: 0, fileNotExists: ['should-be-gone.txt'] },
    };
    const result = await runGate(gate, dir);
    expect(result.passed).toBe(false);
  });

  it('respects durationMaxMs (fast command passes)', async () => {
    const gate: AcceptanceGate = {
      id: 'fast', description: 'quick', command: 'true', expect: { exitCode: 0, durationMaxMs: 5000 },
    };
    const result = await runGate(gate, tmpDir());
    expect(result.passed).toBe(true);
  });

  it('runs multiple gates sequentially and short-circuits at first failure (optional)', async () => {
    const gates: AcceptanceGate[] = [
      { id: 'a', description: 'a', command: 'true', expect: { exitCode: 0 } },
      { id: 'b', description: 'b', command: 'false', expect: { exitCode: 0 } },
      { id: 'c', description: 'c', command: 'true', expect: { exitCode: 0 } },
    ];
    const results = await runGates(gates, tmpDir(), { stopOnFirstFailure: true });
    expect(results.map((r) => r.gateId)).toEqual(['a', 'b']);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });

  it('runs all gates by default', async () => {
    const gates: AcceptanceGate[] = [
      { id: 'a', description: 'a', command: 'true', expect: { exitCode: 0 } },
      { id: 'b', description: 'b', command: 'false', expect: { exitCode: 0 } },
      { id: 'c', description: 'c', command: 'true', expect: { exitCode: 0 } },
    ];
    const results = await runGates(gates, tmpDir());
    expect(results).toHaveLength(3);
  });
});
