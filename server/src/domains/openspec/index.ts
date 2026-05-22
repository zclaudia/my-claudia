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

// G4: Bootstrap services + repositories
export { AiExploreService, buildExplorePrompt, parseExploreResponse } from './ai-explore-service.js';
export { BootstrapService } from './bootstrap-service.js';
export { BootstrapReviewService } from './bootstrap-review-service.js';
export type { ExploreInput, ExploreResult } from './ai-explore-service.js';
export type { BootstrapStartInput, BootstrapStartResult } from './bootstrap-service.js';
export type { ReviewFinalizeResult } from './bootstrap-review-service.js';

// G7: AI drafting service
export { SpecChangeDraftingService } from './spec-change-drafting-service.js';
export type { DraftResult } from './spec-change-drafting-service.js';
export { BootstrapScanRepository } from './repositories/bootstrap-scan-repository.js';
export { BootstrapReviewItemRepository } from './repositories/bootstrap-review-item-repository.js';
export type { BootstrapScan, BootstrapScanStatus } from './repositories/bootstrap-scan-repository.js';
export type {
  BootstrapReviewItem,
  BootstrapReviewOp,
  BootstrapReviewStatus,
} from './repositories/bootstrap-review-item-repository.js';
