import type { StructuredResultTypeEntry } from './types.js';

export class StructuredResultRegistry {
  private readonly entries = new Map<string, StructuredResultTypeEntry<unknown>>();

  register<T>(entry: StructuredResultTypeEntry<T>): void {
    if (this.entries.has(entry.resultType)) {
      throw new Error(`Structured result type "${entry.resultType}" is already registered`);
    }
    this.entries.set(entry.resultType, entry as StructuredResultTypeEntry<unknown>);
  }

  get<T>(resultType: string): StructuredResultTypeEntry<T> | undefined {
    return this.entries.get(resultType) as StructuredResultTypeEntry<T> | undefined;
  }

  has(resultType: string): boolean {
    return this.entries.has(resultType);
  }

  list(): string[] {
    return [...this.entries.keys()];
  }
}
