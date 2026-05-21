import type { ParsedSpec, ParsedRequirement, DeltaDoc } from './markdown/types.js';

export interface MergeResult {
  spec: ParsedSpec;
  /** Names that were added (didn't exist in corpus). */
  added: string[];
  /** Names that were modified (replaced existing). */
  modified: string[];
  /** Names that were removed (matched existing). */
  removed: string[];
  /** ADDED entries whose name already existed in corpus (collision). */
  addedConflicts: string[];
  /** MODIFIED entries whose target didn't exist in corpus. */
  modifiedMissing: string[];
  /** REMOVED entries whose target didn't exist in corpus. */
  removedMissing: string[];
}

export function applyDelta(corpus: ParsedSpec, delta: DeltaDoc): MergeResult {
  // Index existing requirements by name (case-sensitive).
  const byName = new Map<string, ParsedRequirement>();
  for (const r of corpus.requirements) byName.set(r.name, r);

  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  const addedConflicts: string[] = [];
  const modifiedMissing: string[] = [];
  const removedMissing: string[] = [];

  // ADDED
  for (const r of delta.added) {
    if (byName.has(r.name)) {
      addedConflicts.push(r.name);
      // Conservative: skip (don't overwrite via add-as-modify).
      continue;
    }
    byName.set(r.name, r);
    added.push(r.name);
  }

  // MODIFIED
  for (const r of delta.modified) {
    if (!byName.has(r.name)) {
      modifiedMissing.push(r.name);
      // Conservative: insert it anyway (treat as ADDED).
      byName.set(r.name, r);
      continue;
    }
    byName.set(r.name, r);
    modified.push(r.name);
  }

  // REMOVED
  for (const name of delta.removed) {
    if (!byName.has(name)) {
      removedMissing.push(name);
      continue;
    }
    byName.delete(name);
    removed.push(name);
  }

  // Preserve corpus order for surviving + previously-existing requirements; append truly-new ones at the end.
  const orderedNames: string[] = [];
  for (const r of corpus.requirements) if (byName.has(r.name)) orderedNames.push(r.name);
  for (const name of added) if (!orderedNames.includes(name)) orderedNames.push(name);
  // MODIFIED-missing inserts also need to be appended (treated like new additions, but not tracked in `added`).
  for (const name of modifiedMissing) if (byName.has(name) && !orderedNames.includes(name)) orderedNames.push(name);

  const mergedRequirements = orderedNames.map((n) => byName.get(n) as ParsedRequirement);

  return {
    spec: {
      capability: corpus.capability,
      purpose: corpus.purpose, // keep corpus purpose; delta.purpose is change-scoped, not corpus
      requirements: mergedRequirements,
    },
    added,
    modified,
    removed,
    addedConflicts,
    modifiedMissing,
    removedMissing,
  };
}

/**
 * Apply a delta against an EMPTY corpus (first-time capability). All ADDED
 * succeed; MODIFIED becomes ADDED; REMOVED becomes removedMissing.
 */
export function applyDeltaToEmptyCorpus(capability: string, delta: DeltaDoc): MergeResult {
  return applyDelta({ capability, requirements: [] }, delta);
}
