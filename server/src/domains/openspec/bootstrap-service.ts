// server/src/domains/openspec/bootstrap-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { DeltaDoc, ParsedRequirement, ParsedSpec } from './markdown/types.js';
import { parseSpec } from './markdown/spec-parser.js';
import { formatSpec } from './markdown/spec-formatter.js';
import { applyDelta } from './delta-merger.js';
import { AiExploreService, type ExploreInput, type ExploreResult } from './ai-explore-service.js';
import { BootstrapScanRepository, type BootstrapScan } from './repositories/bootstrap-scan-repository.js';
import { BootstrapReviewItemRepository } from './repositories/bootstrap-review-item-repository.js';
import {
  BootstrapCandidateRepository,
  type BootstrapCandidate,
} from './repositories/bootstrap-candidate-repository.js';

const OPENSPEC_DIR = 'openspec';
const SPECS_DIR = 'specs';

export interface BootstrapServiceDeps {
  db: Database;
  explore: AiExploreService;
  getProjectRoot: (projectId: string) => string;
  broadcast?: (scanId: string, payload: { kind: string; [k: string]: unknown }) => void;
}

export interface BootstrapStartInput {
  projectId: string;
  mode: 'initial' | 'rescan';
}

export interface BootstrapStartResult {
  scan: BootstrapScan;
  exploreResult: ExploreResult;
  /** Number of ADDED requirements applied immediately, per capability. */
  appliedSummary: Record<string, number>;
  /** Number of pending review items created, per capability. */
  pendingSummary: Record<string, { modified: number; removed: number }>;
}

export class BootstrapService {
  private scanRepo: BootstrapScanRepository;
  private reviewRepo: BootstrapReviewItemRepository;
  private candidateRepo: BootstrapCandidateRepository;
  private generationRunners = new Map<string, boolean>(); // scanId → cancelled flag

  constructor(private deps: BootstrapServiceDeps) {
    this.scanRepo = new BootstrapScanRepository(deps.db);
    this.reviewRepo = new BootstrapReviewItemRepository(deps.db);
    this.candidateRepo = new BootstrapCandidateRepository(deps.db);
  }

  async commitGeneration(scanId: string): Promise<void> {
    this.assertScanIsActive(scanId, ['picking']);
    const selected = this.candidateRepo.listSelected(scanId);
    if (selected.length === 0) {
      throw new Error('No candidates selected. Pick at least one capability before generating.');
    }
    this.scanRepo.update(scanId, { initPhase: 'generating', status: 'running' });
    this.generationRunners.set(scanId, false);
    void this.runPhase2(scanId).catch((e) => {
      console.error(`[BootstrapService] Phase 2 unhandled error for scan ${scanId}:`, e);
    });
  }

  private async runPhase2(scanId: string): Promise<void> {
    const selected = this.candidateRepo.listSelected(scanId);
    const projectRoot = this.deps.getProjectRoot(this.scanRepo.findById(scanId)!.projectId);

    for (const cand of selected) {
      if (this.generationRunners.get(scanId) === true) {
        this.candidateRepo.update(cand.id, { phase: 'discovered' });
        break;
      }
      this.candidateRepo.update(cand.id, { phase: 'generating' });
      this.deps.broadcast?.(scanId, {
        kind: 'candidate_generation_started',
        candidateId: cand.id,
        capability: cand.capability,
      });

      try {
        const onStream = makeThrottledStreamCallback((contentSoFar) => {
          this.deps.broadcast?.(scanId, {
            kind: 'candidate_generation_progress',
            candidateId: cand.id,
            contentSoFar,
          });
        });
        const result = await this.deps.explore.generateCapabilitySpec({
          capability: { name: cand.capability, description: cand.description },
          workingDirectory: projectRoot,
          onStream,
        });
        const updated = this.candidateRepo.update(cand.id, {
          phase: 'generated',
          generated_md: result.specMd,
          generation_attempts: result.attempts,
        });
        this.deps.broadcast?.(scanId, { kind: 'candidate_generation_completed', candidate: updated });
      } catch (e) {
        const msg = (e as Error).message;
        const updated = this.candidateRepo.update(cand.id, {
          phase: 'failed',
          error_message: msg,
        });
        this.deps.broadcast?.(scanId, { kind: 'candidate_generation_failed', candidate: updated, error: msg });
      }
    }

    this.scanRepo.update(scanId, { initPhase: 'reviewing', status: 'awaiting_review' });
    this.generationRunners.delete(scanId);
  }

  async start(input: BootstrapStartInput): Promise<BootstrapStartResult> {
    // Reject if a scan is already active for this project.
    const active = this.scanRepo.findActiveByProject(input.projectId);
    if (active) {
      throw new Error(
        `A bootstrap scan is already active for project ${input.projectId} (id=${active.id})`,
      );
    }

    if (input.mode === 'initial') {
      return this.startInitial(input);
    }
    return this.startRescan(input);
  }

  private async startInitial(input: BootstrapStartInput): Promise<BootstrapStartResult> {
    const scan = this.scanRepo.create({ projectId: input.projectId });
    this.scanRepo.update(scan.id, { initPhase: 'discovering' });
    const updated = this.scanRepo.findById(scan.id)!;

    console.log(
      `[BootstrapService] starting initial scan ${updated.id} (project=${input.projectId}, root=${this.deps.getProjectRoot(input.projectId)})`,
    );

    // Kick off Phase 1 in the background. Returns immediately.
    void this.runPhase1(updated).catch((e) => {
      console.error(`[BootstrapService] Phase 1 unhandled error for scan ${updated.id}:`, e);
    });

    return {
      scan: updated,
      exploreResult: { perCapability: {}, rawResponse: '', parseErrors: [] },
      appliedSummary: {},
      pendingSummary: {},
    };
  }

  private async runPhase1(scan: BootstrapScan): Promise<void> {
    this.deps.broadcast?.(scan.id, { kind: 'phase1_started' });
    const projectRoot = this.deps.getProjectRoot(scan.projectId);
    const existingCapabilities = readExistingCapabilityFolders(projectRoot);

    let result;
    try {
      result = await this.deps.explore.discoverCapabilities({
        projectId: scan.projectId,
        workingDirectory: projectRoot,
        existingCapabilities,
      });
    } catch (e) {
      const msg = (e as Error).message;
      console.warn(`[BootstrapService] Phase 1 failed for scan ${scan.id}: ${msg}`);
      this.scanRepo.update(scan.id, {
        status: 'failed',
        finishedAt: Date.now(),
        errorMessage: msg,
      });
      this.deps.broadcast?.(scan.id, { kind: 'phase1_failed', error: msg });
      return;
    }

    // Persist candidates (skip those already in existing capabilities)
    const skip = new Set(existingCapabilities);
    for (const c of result.capabilities) {
      if (skip.has(c.name)) continue;
      this.candidateRepo.create({
        scanId: scan.id,
        capability: c.name,
        title: c.name,
        description: c.description,
        source: 'ai_discovered',
      });
    }

    this.scanRepo.update(scan.id, {
      status: 'awaiting_review',
      initPhase: 'picking',
    });
    this.deps.broadcast?.(scan.id, {
      kind: 'phase1_completed',
      candidateCount: result.capabilities.length,
      uncertaintyCount: result.uncertainties.length,
    });
  }

  private async startRescan(input: BootstrapStartInput): Promise<BootstrapStartResult> {
    const scan = this.scanRepo.create({ projectId: input.projectId });
    const projectRoot = this.deps.getProjectRoot(input.projectId);

    console.log(
      `[BootstrapService] starting scan ${scan.id} (project=${input.projectId}, mode=${input.mode}, root=${projectRoot})`,
    );

    let exploreResult: ExploreResult;
    try {
      const exploreInput: ExploreInput = {
        projectId: input.projectId,
        workingDirectory: projectRoot,
        mode: input.mode,
        existingCorpusSummary:
          input.mode === 'rescan' ? summarizeCorpus(projectRoot) : undefined,
      };
      exploreResult = await this.deps.explore.explore(exploreInput);
    } catch (e) {
      this.scanRepo.update(scan.id, {
        status: 'failed',
        finishedAt: Date.now(),
        errorMessage: (e as Error).message,
      });
      throw e;
    }

    // If the AI produced no capabilities AND there were parse / port errors,
    // surface the failure instead of silently completing with 0/0. Otherwise
    // the user sees "scan completed, applied 0" and has no idea why.
    if (
      Object.keys(exploreResult.perCapability).length === 0 &&
      exploreResult.parseErrors.length > 0
    ) {
      const message = `AI explore produced no capabilities. ${exploreResult.parseErrors.join('; ')}`;
      console.warn(`[BootstrapService] scan ${scan.id} failing: ${message}`);
      this.scanRepo.update(scan.id, {
        status: 'failed',
        finishedAt: Date.now(),
        errorMessage: message,
      });
      throw new Error(message);
    }

    const appliedSummary: Record<string, number> = {};
    const pendingSummary: Record<string, { modified: number; removed: number }> = {};
    let appliedCount = 0;
    let pendingCount = 0;

    for (const [capability, delta] of Object.entries(exploreResult.perCapability)) {
      // 1. Apply ADDED slice immediately.
      const addedOnly: DeltaDoc = { added: delta.added, modified: [], removed: [] };
      const corpus = readOrEmptyCorpus(projectRoot, capability);
      const mergeResult = applyDelta(corpus, addedOnly);
      writeCorpus(projectRoot, capability, mergeResult.spec);
      appliedSummary[capability] = mergeResult.added.length;
      appliedCount += mergeResult.added.length;

      // 2. Persist MODIFIED + REMOVED items for review.
      let modified = 0;
      let removed = 0;
      for (const req of delta.modified) {
        this.reviewRepo.create({
          scanId: scan.id,
          capability,
          operation: 'modify',
          payloadJson: JSON.stringify(req),
        });
        modified += 1;
      }
      for (const name of delta.removed) {
        this.reviewRepo.create({
          scanId: scan.id,
          capability,
          operation: 'remove',
          payloadJson: JSON.stringify({ name }),
        });
        removed += 1;
      }
      pendingSummary[capability] = { modified, removed };
      pendingCount += modified + removed;
    }

    // 3. Transition scan status.
    const finalStatus = pendingCount > 0 ? 'awaiting_review' : 'completed';
    const updated = this.scanRepo.update(scan.id, {
      status: finalStatus,
      appliedCount,
      pendingCount,
      finishedAt: finalStatus === 'completed' ? Date.now() : undefined,
    });

    // 4. If completed AND there were items applied, bump corpus meta.
    if (finalStatus === 'completed' && appliedCount > 0) {
      bumpCorpusMeta(this.deps.db, input.projectId);
    }

    console.log(
      `[BootstrapService] scan ${scan.id} ${finalStatus} (capabilities=${Object.keys(exploreResult.perCapability).length}, applied=${appliedCount}, pending=${pendingCount})`,
    );

    return { scan: updated, exploreResult, appliedSummary, pendingSummary };
  }

  /**
   * Cancel a scan by id. Idempotent: cancelling a scan already in a terminal
   * state (completed / cancelled / failed) returns the existing row unchanged.
   * Used by the desktop UI to break out of a stuck scan so the user can start
   * fresh after an interrupted bootstrap.
   */
  cancelScan(scanId: string): BootstrapScan {
    const scan = this.scanRepo.findById(scanId);
    if (!scan) throw new Error(`Scan not found: ${scanId}`);
    if (
      scan.status === 'completed' ||
      scan.status === 'cancelled' ||
      scan.status === 'failed'
    ) {
      return scan; // already terminal — idempotent
    }
    return this.scanRepo.update(scanId, { status: 'cancelled', finishedAt: Date.now() });
  }

  addCandidate(scanId: string, input: { name: string; description: string }): BootstrapCandidate {
    this.assertScanIsActive(scanId, ['picking', 'reviewing', 'generating']);
    if (!/^[a-z][a-z0-9-]*$/.test(input.name)) {
      throw new Error(`Capability name must be kebab-case: got "${input.name}"`);
    }
    const existing = this.candidateRepo.listByScan(scanId).find((c) => c.capability === input.name);
    if (existing) throw new Error(`Capability "${input.name}" already exists in this scan`);
    const c = this.candidateRepo.create({
      scanId,
      capability: input.name,
      title: input.name,
      description: input.description,
      source: 'user_added',
    });
    this.deps.broadcast?.(scanId, { kind: 'candidate_updated', candidate: c });
    return c;
  }

  patchCandidate(
    id: string,
    patch: Partial<{ title: string; description: string; selected: boolean }>,
  ): BootstrapCandidate {
    const before = this.candidateRepo.findById(id);
    if (!before) throw new Error(`Candidate not found: ${id}`);
    this.assertScanIsActive(before.scanId, ['picking', 'reviewing']);
    const c = this.candidateRepo.update(id, patch);
    this.deps.broadcast?.(before.scanId, { kind: 'candidate_updated', candidate: c });
    return c;
  }

  removeCandidate(id: string): void {
    const before = this.candidateRepo.findById(id);
    if (!before) throw new Error(`Candidate not found: ${id}`);
    this.assertScanIsActive(before.scanId, ['picking']);
    const c = this.candidateRepo.update(id, { phase: 'excluded' });
    this.deps.broadcast?.(before.scanId, { kind: 'candidate_updated', candidate: c });
  }

  private assertScanIsActive(scanId: string, allowedPhases: string[]): void {
    const scan = this.scanRepo.findById(scanId);
    if (!scan) throw new Error(`Scan not found: ${scanId}`);
    if (scan.status === 'completed' || scan.status === 'cancelled' || scan.status === 'failed') {
      throw new Error(`Scan is in terminal state: ${scan.status}`);
    }
    if (scan.initPhase && !allowedPhases.includes(scan.initPhase)) {
      throw new Error(`Operation not allowed in init_phase=${scan.initPhase}`);
    }
  }
}

function summarizeCorpus(projectRoot: string): string {
  const dir = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR);
  if (!fs.existsSync(dir)) return '(no existing corpus)';
  const caps: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const specFile = path.join(dir, entry.name, 'spec.md');
    if (fs.existsSync(specFile)) {
      const text = fs.readFileSync(specFile, 'utf-8');
      const reqNames = [...text.matchAll(/^###\s+Requirement:\s*(.+)$/gm)].map((m) =>
        m[1].trim(),
      );
      caps.push(
        `- ${entry.name}: ${reqNames.length} requirements [${reqNames.slice(0, 5).join(', ')}${reqNames.length > 5 ? ', ...' : ''}]`,
      );
    }
  }
  return caps.length > 0 ? caps.join('\n') : '(no existing corpus)';
}

function readExistingCapabilityFolders(projectRoot: string): string[] {
  const dir = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function readOrEmptyCorpus(projectRoot: string, capability: string): ParsedSpec {
  const file = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR, capability, 'spec.md');
  if (!fs.existsSync(file)) return { capability, requirements: [] };
  return parseSpec(fs.readFileSync(file, 'utf-8'));
}

function writeCorpus(projectRoot: string, capability: string, spec: ParsedSpec): void {
  const file = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR, capability, 'spec.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatSpec(spec));
}

function bumpCorpusMeta(db: Database, projectId: string): void {
  db.prepare(
    `INSERT INTO project_spec_corpus_meta (project_id, initialized, last_bootstrap_at, capabilities_json)
     VALUES (?, 1, ?, '[]')
     ON CONFLICT(project_id) DO UPDATE SET initialized = 1, last_bootstrap_at = excluded.last_bootstrap_at`,
  ).run(projectId, Date.now());
}

// Re-export ParsedRequirement for callers that need the shape (Review service).
export type { ParsedRequirement };

function makeThrottledStreamCallback(emit: (s: string) => void, hz = 2): (s: string) => void {
  const minIntervalMs = 1000 / hz;
  let lastEmitAt = 0;
  let pending: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  return (s: string) => {
    pending = s;
    const now = Date.now();
    const since = now - lastEmitAt;
    if (since >= minIntervalMs) {
      lastEmitAt = now;
      emit(s);
      pending = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        if (pending !== null) {
          lastEmitAt = Date.now();
          emit(pending);
          pending = null;
        }
      }, minIntervalMs - since);
    }
  };
}
