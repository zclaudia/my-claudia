import { describe, expect, it } from 'vitest';
import type { PCPCapabilityId, PCPProviderManifest } from '@my-claudia/shared/core/pcp';
import type { ProviderDefinition } from '../definitions.js';
import { providerRegistry } from '../registry.js';

const BUILT_IN_PROVIDERS = ['claude', 'openclaude', 'opencode', 'codex', 'cursor', 'kimi', 'acp'] as const;

const REQUIRED_CAPABILITIES: PCPCapabilityId[] = [
  'chat.generate',
  'chat.stream',
  'tool.call',
  'tool.inject',
  'interaction.form',
  'interaction.approval',
  'interaction.todo',
  'input.image',
  'input.text_file',
  'input.binary_file',
  'permission.mode',
  'session.abort',
  'session.background_task',
];

const POLICY_ONLY_KEYS = [
  'nativeInteractionTools',
  'emptyResultFallback',
  'sessionCwdPolicy',
  'modeSwitchSessionPolicy',
  'authErrorHint',
  'escalateAlwaysTools',
] as const;

function requireDefinition(providerType: string): ProviderDefinition {
  const definition = providerRegistry.getDefinition(providerType);
  expect(definition, `${providerType} should have a provider definition`).toBeDefined();
  return definition!;
}

function capabilityMap(manifest: PCPProviderManifest): Map<PCPCapabilityId, PCPProviderManifest['capabilities'][number]> {
  return new Map(manifest.capabilities.map(capability => [capability.id, capability]));
}

function expectCapability(manifest: PCPProviderManifest, id: PCPCapabilityId, supported = true): void {
  const capability = capabilityMap(manifest).get(id);
  expect(capability, `${manifest.providerType} should declare ${id}`).toBeDefined();
  expect(capability?.supported, `${manifest.providerType} ${id} supported`).toBe(supported);
}

describe('provider contract matrix', () => {
  it('registers every built-in provider with a complete definition', () => {
    for (const providerType of BUILT_IN_PROVIDERS) {
      const adapter = providerRegistry.get(providerType);
      const definition = requireDefinition(providerType);

      expect(adapter).toBeDefined();
      expect(definition.adapter).toBe(adapter);
      expect(definition.capabilityManifest).toBe(adapter?.manifest);
      expect(definition.policy).toBe(adapter?.policy);
      expect(definition.capabilityManifest.providerType).toBe(providerType);
      expect(definition.capabilityManifest.apiVersion).toBe('pcp/v1');
    }
  });

  it('keeps provider runtime policy out of PCP capability manifests', () => {
    for (const providerType of BUILT_IN_PROVIDERS) {
      const { capabilityManifest, policy } = requireDefinition(providerType);
      const manifestRecord = capabilityManifest as unknown as Record<string, unknown>;

      for (const key of POLICY_ONLY_KEYS) {
        expect(manifestRecord[key], `${providerType} manifest should not contain policy key ${key}`).toBeUndefined();
      }

      expect(policy).toBeDefined();
    }
  });

  it('declares the full PCP capability surface exactly once per provider', () => {
    for (const providerType of BUILT_IN_PROVIDERS) {
      const { capabilityManifest } = requireDefinition(providerType);
      const ids = capabilityManifest.capabilities.map(capability => capability.id);

      expect(new Set(ids).size, `${providerType} should not duplicate capabilities`).toBe(ids.length);
      expect(ids.sort()).toEqual([...REQUIRED_CAPABILITIES].sort());
    }
  });

  it('adds implementation metadata for every supported capability', () => {
    for (const providerType of BUILT_IN_PROVIDERS) {
      const { capabilityManifest } = requireDefinition(providerType);

      for (const capability of capabilityManifest.capabilities) {
        if (!capability.supported) continue;

        expect(capability.mode, `${providerType} ${capability.id} should declare mode`).toBeDefined();
        expect(capability.reliability, `${providerType} ${capability.id} should declare reliability`).toBeDefined();
      }
    }
  });

  it('keeps policy-driven interaction behavior backed by matching capabilities', () => {
    const nativeToolToCapability: Record<string, PCPCapabilityId> = {
      update_todo_list: 'interaction.todo',
      ask_user_form: 'interaction.form',
      request_approval: 'interaction.approval',
      enter_plan_mode: 'permission.mode',
      exit_plan_mode: 'permission.mode',
    };

    for (const providerType of BUILT_IN_PROVIDERS) {
      const { capabilityManifest, policy } = requireDefinition(providerType);

      for (const nativeTool of policy.nativeInteractionTools ?? []) {
        expectCapability(capabilityManifest, nativeToolToCapability[nativeTool]);
      }

      if (policy.escalateAlwaysTools?.length) {
        expectCapability(capabilityManifest, 'interaction.approval');
      }

      if (policy.emptyResultFallback) {
        expectCapability(capabilityManifest, 'chat.stream');
      }
    }
  });

  it('keeps normalizer behavior aligned with declared interaction capabilities', () => {
    const claude = requireDefinition('claude');

    expect(claude.normalizer?.normalizeToolUse?.({
      toolUseId: 'tool-todo',
      toolName: 'TodoWrite',
      toolInput: { todos: [{ content: 'Task', status: 'pending' }] },
    })).toMatchObject({ toolInteractionKind: 'todo_update' });
    expectCapability(claude.capabilityManifest, 'interaction.todo');

    expect(claude.normalizer?.normalizePermissionRequest?.({
      requestId: 'req-question',
      toolName: 'AskUserQuestion',
      toolInput: { questions: [] },
    })).toMatchObject({ interactionKind: 'ask_user_question' });
    expectCapability(claude.capabilityManifest, 'interaction.form');

    expect(claude.normalizer?.normalizeToolUse?.({
      toolUseId: 'tool-exit-plan',
      toolName: 'ExitPlanMode',
      toolInput: { plan: 'Plan' },
    })).toMatchObject({
      toolSemantic: 'plan_proposal',
      modeTransition: {
        mode: 'default',
        reason: 'exit',
        sourceToolUseId: 'tool-exit-plan',
      },
    });
    expectCapability(claude.capabilityManifest, 'permission.mode');
    expectCapability(claude.capabilityManifest, 'interaction.approval');
  });
});
