// server/src/domains/meta-workflow/__tests__/workflow-synthesizer.test.ts
import { describe, it, expect } from 'vitest';
import { synthesizeWorkflow } from '../workflow-synthesizer.js';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

const phase: PhaseDef = {
  id: 'p1', name: 'Impl X', description: 'Implement X',
  phaseType: 'code-implement',
  dependsOn: [],
  inputs: [{ kind: 'file', source: 'design/requirements.md' }],
  outputs: [{ kind: 'commit', description: 'commit' }],
  acceptanceGates: [
    { id: 'compile', description: 'compile', command: 'mvn compile', expect: { exitCode: 0 } },
    { id: 'tests', description: 'tests', command: 'mvn test', expect: { exitCode: 0 } },
  ],
};

describe('workflow synthesizer', () => {
  it('returns the 5 skeleton nodes in order', () => {
    const def = synthesizeWorkflow(phase);
    const ids = def.nodes.map((n) => n.id);
    expect(ids).toEqual(['context_load', 'plan', 'execute', 'verify', 'commit']);
    expect(def.entryNodeId).toBe('context_load');
  });

  it('plan node is skipped if planRequired=false (single-shot)', () => {
    const designPhase: PhaseDef = { ...phase, phaseType: 'design-doc' };
    const def = synthesizeWorkflow(designPhase);
    const ids = def.nodes.map((n) => n.id);
    expect(ids).toContain('plan');  // node still exists but is set up to fast-path
    // Behavioral check: the design-doc template returns planRequired=false,
    // so the plan node's config should mark it as optional.
    const planNode = def.nodes.find((n) => n.id === 'plan');
    expect(planNode?.config?.planRequired).toBe(false);
  });

  it('verify node embeds acceptanceGates as shell sub-steps', () => {
    const def = synthesizeWorkflow(phase);
    const verifyNode = def.nodes.find((n) => n.id === 'verify');
    expect(verifyNode?.type).toBe('shell');
    const cfg = verifyNode!.config as { gates: { id: string; command: string }[] };
    expect(cfg.gates).toHaveLength(2);
    expect(cfg.gates[0].command).toBe('mvn compile');
    expect(cfg.gates[1].command).toBe('mvn test');
  });

  it('execute node embeds the phaseType prompt', () => {
    const def = synthesizeWorkflow(phase);
    const exec = def.nodes.find((n) => n.id === 'execute');
    expect(exec?.type).toBe('ai_prompt');
    expect((exec!.config as { prompt: string }).prompt).toMatch(/self-healing/);
    expect((exec!.config as { prompt: string }).prompt).toMatch(/Implement X/);
  });

  it('linear edges connect all 5 nodes', () => {
    const def = synthesizeWorkflow(phase);
    expect(def.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      'context_load->plan',
      'plan->execute',
      'execute->verify',
      'verify->commit',
    ]);
  });

  it('propagates runtime provider id to ai_prompt nodes', () => {
    const def = synthesizeWorkflow({ ...phase, runtimeProviderId: 'provider-x' });
    const aiNodes = def.nodes.filter((n) => n.type === 'ai_prompt');
    for (const n of aiNodes) {
      expect((n.config as { providerId?: string }).providerId).toBe('provider-x');
    }
  });
});
