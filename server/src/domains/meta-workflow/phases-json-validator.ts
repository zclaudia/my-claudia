// server/src/domains/meta-workflow/phases-json-validator.ts
import {
  PHASE_TYPES,
  EXECUTE_ENTITIES,
  type PhasesDoc,
  type PhaseDef,
  type PhaseType,
} from '@my-claudia/shared/features/meta-workflow';

export type ValidationResult =
  | { ok: true; doc: PhasesDoc }
  | { ok: false; errors: string[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function validatePhasesJson(input: string | unknown): ValidationResult {
  const errors: string[] = [];

  let raw: unknown;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
    }
  } else {
    raw = input;
  }

  if (!isObject(raw)) return { ok: false, errors: ['Top-level value must be an object'] };

  if (raw.version !== '1') errors.push(`version must be '1', got ${JSON.stringify(raw.version)}`);

  if (!Array.isArray(raw.phases)) {
    errors.push('phases must be an array');
    return { ok: false, errors };
  }

  if (!isStringArray(raw.smokePath)) errors.push('smokePath must be an array of strings');

  if (!isObject(raw.metadata)) {
    errors.push('metadata must be an object');
  } else {
    if (typeof raw.metadata.generatedAt !== 'number') errors.push('metadata.generatedAt must be a number');
    if (typeof raw.metadata.requirementsPath !== 'string') errors.push('metadata.requirementsPath must be a string');
  }

  const phases: PhaseDef[] = [];
  const phaseIds = new Set<string>();

  for (let i = 0; i < raw.phases.length; i += 1) {
    const p = raw.phases[i];
    if (!isObject(p)) { errors.push(`phases[${i}] must be an object`); continue; }

    const id = p.id;
    if (typeof id !== 'string' || id.length === 0) { errors.push(`phases[${i}].id must be a non-empty string`); continue; }
    if (phaseIds.has(id)) errors.push(`Duplicate phase id: ${id}`);
    phaseIds.add(id);

    if (typeof p.name !== 'string') errors.push(`phases[${id}].name must be a string`);
    if (typeof p.description !== 'string') errors.push(`phases[${id}].description must be a string`);

    const phaseType = p.phaseType;
    if (typeof phaseType !== 'string' || !PHASE_TYPES.includes(phaseType as PhaseType)) {
      errors.push(`phases[${id}].phaseType must be one of ${PHASE_TYPES.join(', ')}; got ${JSON.stringify(phaseType)}`);
    }

    if (p.executeEntity !== undefined && (typeof p.executeEntity !== 'string'
        || !EXECUTE_ENTITIES.includes(p.executeEntity as never))) {
      errors.push(`phases[${id}].executeEntity must be one of ${EXECUTE_ENTITIES.join(', ')}`);
    }

    if (!isStringArray(p.dependsOn)) errors.push(`phases[${id}].dependsOn must be string[]`);
    if (!Array.isArray(p.inputs)) errors.push(`phases[${id}].inputs must be an array`);
    if (!Array.isArray(p.outputs)) errors.push(`phases[${id}].outputs must be an array`);

    if (!Array.isArray(p.acceptanceGates) || p.acceptanceGates.length === 0) {
      errors.push(`phases[${id}].acceptanceGates must be a non-empty array`);
    } else {
      for (let j = 0; j < p.acceptanceGates.length; j += 1) {
        const g = p.acceptanceGates[j];
        if (!isObject(g)) { errors.push(`phases[${id}].acceptanceGates[${j}] must be an object`); continue; }
        if (typeof g.id !== 'string' || !g.id) errors.push(`phases[${id}].acceptanceGates[${j}].id required`);
        if (typeof g.command !== 'string' || !g.command) {
          errors.push(`phases[${id}].acceptanceGates[${j}].command must be a non-empty string`);
        }
        if (!isObject(g.expect)) errors.push(`phases[${id}].acceptanceGates[${j}].expect must be an object`);
      }
    }

    phases.push(p as unknown as PhaseDef);
  }

  // Cross-phase checks
  for (const p of phases) {
    for (const dep of p.dependsOn) {
      if (!phaseIds.has(dep)) errors.push(`phases[${p.id}].dependsOn references nonexistent phase '${dep}'`);
    }
  }

  // At least one root
  const roots = phases.filter((p) => p.dependsOn.length === 0);
  if (roots.length === 0 && phases.length > 0) errors.push('At least one phase must have no dependsOn (root)');

  // Cycle detection (DFS)
  const adjacency = new Map<string, string[]>();
  for (const p of phases) adjacency.set(p.id, p.dependsOn);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const p of phases) color.set(p.id, WHITE);

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    for (const next of adjacency.get(node) ?? []) {
      const c = color.get(next);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const p of phases) {
    if (color.get(p.id) === WHITE && dfs(p.id)) {
      errors.push(`Phase graph contains a cycle (reachable from '${p.id}')`);
      break;
    }
  }

  // smokePath validity
  if (isStringArray(raw.smokePath)) {
    for (const id of raw.smokePath) {
      if (!phaseIds.has(id)) errors.push(`smokePath references nonexistent phase '${id}'`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, doc: raw as unknown as PhasesDoc };
}
