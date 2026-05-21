// server/src/domains/executor/executor-registry.ts
import type { ExecutorInstance, ExecutorType } from '@my-claudia/shared/features/executor';
import type { IExecutor, ExecutorFactory } from './executor-port.js';

/**
 * Holds one factory per ExecutorType. The Issue layer resolves a concrete
 * IExecutor by calling `resolve(instance)`.
 */
export class ExecutorRegistry {
  private factories = new Map<ExecutorType, ExecutorFactory>();

  register(type: ExecutorType, factory: ExecutorFactory): void {
    this.factories.set(type, factory);
  }

  has(type: ExecutorType): boolean {
    return this.factories.has(type);
  }

  resolve(instance: ExecutorInstance): IExecutor {
    const factory = this.factories.get(instance.type);
    if (!factory) {
      throw new Error(`No executor factory registered for type='${instance.type}'`);
    }
    return factory(instance);
  }
}
