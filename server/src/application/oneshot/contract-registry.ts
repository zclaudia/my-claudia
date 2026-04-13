import type { OneShotTaskContract, OneShotTaskContractRegistry } from './types.js';
import { AI_REVIEW_V1_RESULT_TYPE } from '../structured-result/builtins.js';

export class DefaultContractRegistry implements OneShotTaskContractRegistry {
  private readonly contracts = new Map<string, OneShotTaskContract<unknown>>();

  register<T>(contract: OneShotTaskContract<T>): void {
    if (this.contracts.has(contract.taskType)) {
      throw new Error(`Task contract "${contract.taskType}" is already registered`);
    }
    this.contracts.set(contract.taskType, contract as OneShotTaskContract<unknown>);
  }

  get<T = unknown>(taskType: string): OneShotTaskContract<T> | undefined {
    return this.contracts.get(taskType) as OneShotTaskContract<T> | undefined;
  }

  list(): string[] {
    return [...this.contracts.keys()];
  }
}

// ── Built-in contracts ─────────────────────────────────────────

export const AI_REVIEW_TASK_TYPE = 'ai_review';

export const aiReviewContract: OneShotTaskContract = {
  taskType: AI_REVIEW_TASK_TYPE,
  resultType: AI_REVIEW_V1_RESULT_TYPE,
  requireStructuredSubmit: false, // Phase 2a: fallback-compatible
  maxValidationFailures: 2,
};

export function registerBuiltInContracts(registry: OneShotTaskContractRegistry): void {
  registry.register(aiReviewContract);
}
