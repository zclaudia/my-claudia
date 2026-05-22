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

const OPENSPEC_DIR = 'openspec';
const SPECS_DIR = 'specs';

export interface BootstrapServiceDeps {
  db: Database;
  explore: AiExploreService;
  getProjectRoot: (projectId: string) => string;
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

  constructor(private deps: BootstrapServiceDeps) {
    this.scanRepo = new BootstrapScanRepository(deps.db);
    this.reviewRepo = new BootstrapReviewItemRepository(deps.db);
  }

  async start(input: BootstrapStartInput): Promise<BootstrapStartResult> {
    // Reject if a scan is already active for this project.
    const active = this.scanRepo.findActiveByProject(input.projectId);
    if (active) {
      throw new Error(
        `A bootstrap scan is already active for project ${input.projectId} (id=${active.id})`,
      );
    }

    const scan = this.scanRepo.create({ projectId: input.projectId });
    const projectRoot = this.deps.getProjectRoot(input.projectId);

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
