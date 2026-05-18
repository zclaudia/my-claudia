// server/src/domains/meta-workflow/workflow-synthesizer.ts
import type {
  PhaseDef,
} from '@my-claudia/shared/features/meta-workflow';
import type {
  WorkflowDefinition,
  WorkflowNodeDef,
  WorkflowEdgeDef,
} from '@my-claudia/shared/features/workflows';
import { getPhaseTemplate } from './phase-templates/index.js';

/**
 * Build the deterministic 5-node Skeleton+Slot WorkflowDefinition for a phase.
 * Phase B: hand-coded skeleton. Phase D+: enriched with AI-generated `execute`
 * slot via the reuse-pool / WorkflowGeneratorService.
 */
export function synthesizeWorkflow(phase: PhaseDef): WorkflowDefinition {
  const template = getPhaseTemplate(phase.phaseType);
  const planRequired = phase.executeConfig?.planRequired ?? template.defaultPlanRequired;
  const providerId = phase.runtimeProviderId;
  const prompt = template.buildSynthesizerPrompt(phase);

  const nodes: WorkflowNodeDef[] = [
    {
      id: 'context_load',
      name: 'Load context',
      type: 'ai_prompt',
      config: {
        prompt: `Load context for phase "${phase.id}". Inputs: ${JSON.stringify(phase.inputs)}. Outputs expected: ${JSON.stringify(phase.outputs)}.`,
        providerId,
      },
      position: { x: 100, y: 100 },
    },
    {
      id: 'plan',
      name: 'Plan',
      type: 'ai_prompt',
      config: {
        prompt: planRequired
          ? `Produce a plan.md for phase "${phase.id}". Description: ${phase.description}.`
          : `(planRequired=false) skip planning; pass through.`,
        planRequired,
        providerId,
      },
      position: { x: 100, y: 200 },
    },
    {
      id: 'execute',
      name: 'Execute',
      type: 'ai_prompt',
      config: { prompt, providerId },
      position: { x: 100, y: 300 },
    },
    {
      id: 'verify',
      name: 'Verify acceptance gates',
      type: 'shell',
      config: {
        gates: phase.acceptanceGates.map((g) => ({
          id: g.id,
          command: g.command,
          cwd: g.cwd,
          expect: g.expect,
        })),
      },
      position: { x: 100, y: 400 },
    },
    {
      id: 'commit',
      name: 'Commit phase outputs',
      type: 'git_commit',
      config: {
        message: `phase ${phase.id}: ${phase.name}`,
      },
      position: { x: 100, y: 500 },
    },
  ];

  const edges: WorkflowEdgeDef[] = [
    { id: 'e1', source: 'context_load', target: 'plan', type: 'success' },
    { id: 'e2', source: 'plan', target: 'execute', type: 'success' },
    { id: 'e3', source: 'execute', target: 'verify', type: 'success' },
    { id: 'e4', source: 'verify', target: 'commit', type: 'success' },
  ];

  return {
    nodes,
    edges,
    entryNodeId: 'context_load',
    triggers: [],
  };
}
