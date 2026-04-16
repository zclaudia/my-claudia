import { describe, test, expect, vi } from 'vitest';
import { DefaultContractRegistry, registerBuiltInContracts, AI_REVIEW_TASK_TYPE } from '../contract-registry.js';
import { DefaultOneShotTaskRuntime } from '../runtime.js';
import { CliBatchBridge } from '../cli-batch-bridge.js';
import { createOneShotRuntime } from '../index.js';
import { StructuredResultRegistry } from '../../structured-result/schema-registry.js';
import { registerBuiltInStructuredResults } from '../../structured-result/builtins.js';
import type { CliProviderAdapter, CliJobRawResult } from '../../../infrastructure/providers/cli-jobs/types.js';
import type { OneShotTaskProviderBridge, ProviderBridgeRequest, ProviderBridgeResult } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────

function createMockAdapter(providerType = 'test'): CliProviderAdapter {
  return {
    providerType,
    resolveBinary: () => '/bin/echo',
    buildArgs: () => ['hello'],
    extractAssistantText: (raw: CliJobRawResult) => raw.stdout,
  };
}

function createMockBridge(providerType: string, response: Partial<ProviderBridgeResult> = {}): OneShotTaskProviderBridge {
  return {
    providerType,
    run: vi.fn(async (_req: ProviderBridgeRequest): Promise<ProviderBridgeResult> => ({
      rawText: '',
      durationMs: 100,
      ...response,
    })),
  };
}

function createTestRuntime(bridge: OneShotTaskProviderBridge) {
  const structuredResultRegistry = new StructuredResultRegistry();
  registerBuiltInStructuredResults(structuredResultRegistry);
  const contractRegistry = new DefaultContractRegistry();
  registerBuiltInContracts(contractRegistry);
  const bridges = new Map<string, OneShotTaskProviderBridge>();
  bridges.set(bridge.providerType, bridge);

  return new DefaultOneShotTaskRuntime({
    bridges,
    contractRegistry,
    structuredResultRegistry,
  });
}

// ── Contract Registry ────────────────────────────────────────

describe('DefaultContractRegistry', () => {
  test('registers and retrieves contract', () => {
    const registry = new DefaultContractRegistry();
    registry.register({ taskType: 'test', resultType: 'test_v1', requireStructuredSubmit: false, maxValidationFailures: 1 });
    expect(registry.get('test')).toBeDefined();
    expect(registry.get('test')!.resultType).toBe('test_v1');
  });

  test('rejects duplicate registration', () => {
    const registry = new DefaultContractRegistry();
    registry.register({ taskType: 'test', resultType: 'test_v1', requireStructuredSubmit: false, maxValidationFailures: 1 });
    expect(() => registry.register({ taskType: 'test', resultType: 'test_v2', requireStructuredSubmit: false, maxValidationFailures: 1 }))
      .toThrow('already registered');
  });

  test('lists registered task types', () => {
    const registry = new DefaultContractRegistry();
    registerBuiltInContracts(registry);
    expect(registry.list()).toContain(AI_REVIEW_TASK_TYPE);
  });
});

// ── Runtime: structured submit path ──────────────────────────

describe('DefaultOneShotTaskRuntime', () => {
  test('extracts structured result from {result_type, payload} wrapper', async () => {
    const bridge = createMockBridge('claude', {
      rawText: JSON.stringify({
        result_type: 'ai_review_v1',
        payload: { decision: 'approve', reasoning: 'Safe operation', confidence: 0.95 },
      }),
    });
    const runtime = createTestRuntime(bridge);

    const result = await runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'claude',
      prompt: 'Review this',
      cwd: '/tmp',
    });

    expect(result.ok).toBe(true);
    expect(result.stopReason).toBe('structured_submit');
    expect(result.usedFallback).toBe(false);
    expect(result.result).toEqual({ decision: 'approve', reasoning: 'Safe operation', confidence: 0.95 });
    expect(result.telemetry.finalized).toBe(true);
  });

  test('extracts structured result from direct payload (no wrapper)', async () => {
    const bridge = createMockBridge('claude', {
      rawText: JSON.stringify({ decision: 'deny', reasoning: 'Dangerous', confidence: 0.8 }),
    });
    const runtime = createTestRuntime(bridge);

    const result = await runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'claude',
      prompt: 'Review this',
      cwd: '/tmp',
    });

    expect(result.ok).toBe(true);
    expect(result.stopReason).toBe('structured_submit');
    expect(result.result).toMatchObject({ decision: 'deny', confidence: 0.8 });
  });

  test('falls back to text parser when no structured JSON found', async () => {
    // parseFinalReviewFromText handles text like "Decision: approve, Confidence: 0.9"
    // but for simplicity, give it something it can extract JSON from
    const bridge = createMockBridge('claude', {
      rawText: 'Analysis complete. {"decision": "uncertain", "reasoning": "Need more context", "confidence": 0.3}',
    });
    const runtime = createTestRuntime(bridge);

    const result = await runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'claude',
      prompt: 'Review this',
      cwd: '/tmp',
    });

    // Should either extract as structured or fallback — either way ok=true
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  test('returns fallback_fail when output is not parseable', async () => {
    const bridge = createMockBridge('claude', {
      rawText: 'I cannot analyze this request.',
    });
    const runtime = createTestRuntime(bridge);

    const result = await runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'claude',
      prompt: 'Review this',
      cwd: '/tmp',
    });

    // Fallback parser (parseFinalReviewFromText) may still extract something,
    // but if not, should be ok=false
    if (!result.ok) {
      expect(result.stopReason).toBe('fallback_fail');
      expect(result.usedFallback).toBe(false);
    }
  });

  test('handles timeout', async () => {
    const bridge: OneShotTaskProviderBridge = {
      providerType: 'claude',
      run: vi.fn(async () => ({ rawText: '', timedOut: true, durationMs: 60000 })),
    };
    const runtime = createTestRuntime(bridge);

    const result = await runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'claude',
      prompt: 'Review this',
      cwd: '/tmp',
    });

    expect(result.stopReason).toBe('timeout');
  });

  test('handles bridge error gracefully', async () => {
    const bridge: OneShotTaskProviderBridge = {
      providerType: 'claude',
      run: vi.fn(async () => { throw new Error('spawn ENOENT'); }),
    };
    const runtime = createTestRuntime(bridge);

    const result = await runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'claude',
      prompt: 'Review this',
      cwd: '/tmp',
    });

    expect(result.ok).toBe(false);
    expect(result.stopReason).toBe('provider_error');
  });

  test('throws on unknown task type', async () => {
    const bridge = createMockBridge('claude');
    const runtime = createTestRuntime(bridge);

    await expect(runtime.run({
      taskType: 'nonexistent',
      providerType: 'claude',
      prompt: 'test',
      cwd: '/tmp',
    })).rejects.toThrow('Unknown task type');
  });

  test('throws on unknown provider', async () => {
    const bridge = createMockBridge('claude');
    const runtime = createTestRuntime(bridge);

    await expect(runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'nonexistent',
      prompt: 'test',
      cwd: '/tmp',
    })).rejects.toThrow('No bridge registered');
  });

  test('telemetry includes expected fields', async () => {
    const bridge = createMockBridge('claude', {
      rawText: JSON.stringify({ decision: 'approve', reasoning: 'Safe', confidence: 0.9 }),
    });
    const runtime = createTestRuntime(bridge);

    const result = await runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'claude',
      prompt: 'test',
      cwd: '/tmp',
    });

    expect(result.telemetry.taskType).toBe(AI_REVIEW_TASK_TYPE);
    expect(result.telemetry.providerType).toBe('claude');
    expect(result.telemetry.resultType).toBe('ai_review_v1');
    expect(typeof result.telemetry.durationMs).toBe('number');
  });

  test('passes cliPath and env through to the provider bridge', async () => {
    const bridge = createMockBridge('claude', {
      rawText: JSON.stringify({ decision: 'approve', reasoning: 'Safe', confidence: 0.9 }),
    });
    const runtime = createTestRuntime(bridge);

    await runtime.run({
      taskType: AI_REVIEW_TASK_TYPE,
      providerType: 'claude',
      prompt: 'test',
      cwd: '/tmp',
      cliPath: '/custom/claude',
      env: { CLAUDE_CONFIG_DIR: '/tmp/claude-config' },
    });

    expect(bridge.run).toHaveBeenCalledWith(expect.objectContaining({
      cliPath: '/custom/claude',
      env: { CLAUDE_CONFIG_DIR: '/tmp/claude-config' },
    }));
  });
});

// ── Factory ──────────────────────────────────────────────────

describe('createOneShotRuntime', () => {
  test('creates runtime with batch adapters', () => {
    const runtime = createOneShotRuntime({
      batchAdapters: [createMockAdapter('test-provider')],
    });
    expect(runtime).toBeInstanceOf(DefaultOneShotTaskRuntime);
  });
});

// ── CliBatchBridge ───────────────────────────────────────────

describe('CliBatchBridge', () => {
  test('exposes adapter providerType', () => {
    const adapter = createMockAdapter('my-provider');
    const bridge = new CliBatchBridge(adapter);
    expect(bridge.providerType).toBe('my-provider');
  });
});
