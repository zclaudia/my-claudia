// server/src/domains/openspec/index.ts
export { SpecChangeService } from './spec-change-service.js';
export { ArchiveService } from './archive-service.js';
export { parseSpec } from './markdown/spec-parser.js';
export { parseDelta } from './markdown/delta-parser.js';
export { formatSpec, formatRequirement } from './markdown/spec-formatter.js';
export { applyDelta, applyDeltaToEmptyCorpus } from './delta-merger.js';
export { validateSpec, validateDelta } from './validator.js';
export type {
  ParsedSpec,
  ParsedRequirement,
  ParsedScenario,
  DeltaDoc,
  DeltaOp,
  RfcKeyword,
} from './markdown/types.js';
export type { MergeResult } from './delta-merger.js';
export type { ValidationResult, ValidationIssue } from './validator.js';
export type { ArchiveResult, CapabilityArchiveSummary } from './archive-service.js';
