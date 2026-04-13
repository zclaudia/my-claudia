export type {
  OneShotTaskRuntime,
  OneShotTaskRequest,
  OneShotTaskResult,
  OneShotTaskTelemetry,
  OneShotStopReason,
  OneShotTaskContract,
  OneShotTaskContractRegistry,
  OneShotTaskProviderBridge,
  ProviderBridgeRequest,
  ProviderBridgeResult,
  ToolCall,
  ToolCallOutcome,
} from './types.js';

export { DefaultContractRegistry, AI_REVIEW_TASK_TYPE, aiReviewContract, registerBuiltInContracts } from './contract-registry.js';
export { CliBatchBridge } from './cli-batch-bridge.js';
export { CliInteractiveBridge, type InteractivePromptProvider, type InteractiveToolHandler, type CliInteractiveBridgeOptions } from './cli-interactive-bridge.js';
export { DefaultOneShotTaskRuntime, type OneShotTaskRuntimeDeps } from './runtime.js';

// ── Convenience factory ────────────────────────────────────────

import { StructuredResultRegistry } from '../structured-result/schema-registry.js';
import { registerBuiltInStructuredResults } from '../structured-result/builtins.js';
import { DefaultContractRegistry, registerBuiltInContracts } from './contract-registry.js';
import { CliBatchBridge } from './cli-batch-bridge.js';
import { DefaultOneShotTaskRuntime } from './runtime.js';
import type { CliProviderAdapter } from '../../infrastructure/providers/cli-jobs/types.js';
import type { OneShotTaskProviderBridge } from './types.js';

export interface CreateOneShotRuntimeOptions {
  /** Batch-mode adapters to wrap in CliBatchBridge. */
  batchAdapters: CliProviderAdapter[];
  /** Additional pre-built bridges (for interactive mode in Phase 2b). */
  additionalBridges?: OneShotTaskProviderBridge[];
}

export function createOneShotRuntime(options: CreateOneShotRuntimeOptions): DefaultOneShotTaskRuntime {
  const structuredResultRegistry = new StructuredResultRegistry();
  registerBuiltInStructuredResults(structuredResultRegistry);

  const contractRegistry = new DefaultContractRegistry();
  registerBuiltInContracts(contractRegistry);

  const bridges = new Map<string, OneShotTaskProviderBridge>();
  for (const adapter of options.batchAdapters) {
    bridges.set(adapter.providerType, new CliBatchBridge(adapter));
  }
  for (const bridge of options.additionalBridges ?? []) {
    bridges.set(bridge.providerType, bridge);
  }

  return new DefaultOneShotTaskRuntime({
    bridges,
    contractRegistry,
    structuredResultRegistry,
  });
}
