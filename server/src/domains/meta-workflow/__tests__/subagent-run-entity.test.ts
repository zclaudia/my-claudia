// server/src/domains/meta-workflow/__tests__/subagent-run-entity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubagentRunEntity } from '../run-entities/subagent-run-entity.js';
import type { MetaSubagentTemplate } from '@my-claudia/shared/features/meta-workflow';

const baseTemplate: MetaSubagentTemplate = {
  id: 's1',
  systemPrompt: 'You investigate.',
  allowedTools: ['Read', 'Grep'],
  maxTurns: 5,
  terminationCondition: { kind: 'output-file', target: 'report.md' },
  sourceType: 'auto',
  createdAt: 0,
  updatedAt: 0,
};

describe('subagent run-entity adapter', () => {
  it('returns exitOk=true when output-file is produced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockImplementation(async () => {
      writeFileSync(join(dir, 'report.md'), '# report');
      return { ok: true };
    });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: baseTemplate },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(true);
    expect(runVirtualClient).toHaveBeenCalledOnce();
  });

  it('returns exitOk=false when output-file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockResolvedValue({ ok: true });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: baseTemplate },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(false);
  });

  it('output-keyword termination matches when AI output contains keyword', async () => {
    const tmpl: MetaSubagentTemplate = {
      ...baseTemplate,
      terminationCondition: { kind: 'output-keyword', target: '[INVESTIGATION_COMPLETE]' },
    };
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockResolvedValue({
      ok: true,
      output: 'I have finished my investigation. [INVESTIGATION_COMPLETE]',
    });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: tmpl },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(true);
  });

  it('output-keyword termination fails when keyword is missing', async () => {
    const tmpl: MetaSubagentTemplate = {
      ...baseTemplate,
      terminationCondition: { kind: 'output-keyword', target: '[DONE]' },
    };
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockResolvedValue({ ok: true, output: 'lorem ipsum' });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: tmpl },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(false);
  });

  it('rejects non-subagent kind', async () => {
    const runVirtualClient = vi.fn();
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    await expect(runEntity(
      { kind: 'workflow', workflow: {} as never, workflowId: 'w' },
      { worktreePath: '/tmp' },
    )).rejects.toThrow(/subagent/i);
  });

  it('returns exitOk=false when virtual client itself fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-test-'));
    const runVirtualClient = vi.fn().mockResolvedValue({ ok: false });
    const runEntity = createSubagentRunEntity({ runVirtualClient });
    const outcome = await runEntity(
      { kind: 'subagent', subagent: baseTemplate },
      { worktreePath: dir },
    );
    expect(outcome.exitOk).toBe(false);
  });
});
