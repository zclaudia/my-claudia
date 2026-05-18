// server/src/domains/meta-workflow/run-entities/subagent-run-entity.ts
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import type {
  RunEntity,
  SynthesizedEntity,
  RunEntityOutcome,
} from '../phase-executor.js';
import type { MetaSubagentTemplate } from '@my-claudia/shared/features/meta-workflow';

export interface VirtualClientResult {
  ok: boolean;
  output?: string;
}

export interface VirtualClientArgs {
  systemPrompt: string;
  allowedTools: string[];
  maxTurns: number;
  cwd: string;
}

export type RunVirtualClient = (args: VirtualClientArgs) => Promise<VirtualClientResult>;

export interface CreateSubagentRunEntityOptions {
  runVirtualClient: RunVirtualClient;
}

function checkTermination(
  tmpl: MetaSubagentTemplate,
  cwd: string,
  output: string | undefined,
): boolean {
  const cond = tmpl.terminationCondition;
  if (cond.kind === 'output-file') {
    const p = isAbsolute(cond.target) ? cond.target : join(cwd, cond.target);
    return existsSync(p);
  }
  if (cond.kind === 'output-keyword') {
    return (output ?? '').includes(cond.target);
  }
  return false;
}

export function createSubagentRunEntity(opts: CreateSubagentRunEntityOptions): RunEntity {
  return async (entity: SynthesizedEntity, ctx): Promise<RunEntityOutcome> => {
    if (entity.kind !== 'subagent') {
      throw new Error(`subagent run-entity received non-subagent kind: ${entity.kind}`);
    }
    const tmpl = entity.subagent;
    const result = await opts.runVirtualClient({
      systemPrompt: tmpl.systemPrompt,
      allowedTools: tmpl.allowedTools,
      maxTurns: tmpl.maxTurns,
      cwd: ctx.worktreePath,
    });
    if (!result.ok) return { exitOk: false };
    return { exitOk: checkTermination(tmpl, ctx.worktreePath, result.output) };
  };
}
