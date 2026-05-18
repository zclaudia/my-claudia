// server/src/domains/meta-workflow/subagent-synthesizer.ts
import type {
  PhaseDef,
  MetaSubagentTemplate,
  MetaSubagentTerminationCondition,
} from '@my-claudia/shared/features/meta-workflow';
import { getPhaseTemplate } from './phase-templates/index.js';
import { v4 as uuidv4 } from 'uuid';

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch'];

export function synthesizeSubagent(phase: PhaseDef): MetaSubagentTemplate {
  const template = getPhaseTemplate(phase.phaseType);
  const systemPrompt = template.buildSynthesizerPrompt(phase);

  // Determine termination: prefer the first file output, else fall back to a keyword.
  const fileOutput = phase.outputs.find((o) => o.kind === 'file' && o.path);
  const terminationCondition: MetaSubagentTerminationCondition = fileOutput?.path
    ? { kind: 'output-file', target: fileOutput.path }
    : { kind: 'output-keyword', target: '[INVESTIGATION_COMPLETE]' };

  const maxTurns = phase.executeConfig?.maxSubagentTurns ?? 30;

  const now = Date.now();
  return {
    id: uuidv4(),
    name: undefined,
    systemPrompt,
    allowedTools: [...READ_ONLY_TOOLS],
    maxTurns,
    terminationCondition,
    sourceType: 'auto',
    createdAt: now,
    updatedAt: now,
  };
}
