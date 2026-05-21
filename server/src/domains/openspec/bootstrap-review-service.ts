// server/src/domains/openspec/bootstrap-review-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { DeltaDoc, ParsedRequirement, ParsedSpec } from './markdown/types.js';
import { parseSpec } from './markdown/spec-parser.js';
import { formatSpec } from './markdown/spec-formatter.js';
import { applyDelta } from './delta-merger.js';
import { BootstrapScanRepository, type BootstrapScan } from './repositories/bootstrap-scan-repository.js';
import {
  BootstrapReviewItemRepository,
  type BootstrapReviewItem,
} from './repositories/bootstrap-review-item-repository.js';

const OPENSPEC_DIR = 'openspec';
const SPECS_DIR = 'specs';

export interface BootstrapReviewServiceDeps {
  db: Database;
  getProjectRoot: (projectId: string) => string;
}

export interface ReviewFinalizeResult {
  scan: BootstrapScan;
  /** Number of items merged into the corpus, per capability. */
  mergedSummary: Record<string, { modified: number; removed: number }>;
}

export class BootstrapReviewService {
  private scanRepo: BootstrapScanRepository;
  private reviewRepo: BootstrapReviewItemRepository;

  constructor(private deps: BootstrapReviewServiceDeps) {
    this.scanRepo = new BootstrapScanRepository(deps.db);
    this.reviewRepo = new BootstrapReviewItemRepository(deps.db);
  }

  listPending(scanId: string): BootstrapReviewItem[] {
    return this.reviewRepo.listPendingByScan(scanId);
  }

  listAll(scanId: string): BootstrapReviewItem[] {
    return this.reviewRepo.listByScan(scanId);
  }

  approve(itemId: string): BootstrapReviewItem {
    return this.reviewRepo.update(itemId, { status: 'approved', resolvedAt: Date.now() });
  }

  reject(itemId: string): BootstrapReviewItem {
    return this.reviewRepo.update(itemId, { status: 'rejected', resolvedAt: Date.now() });
  }

  /**
   * If all items for this scan are resolved, apply the approved ones to the corpus,
   * mark scan completed, and bump corpus meta. Returns the merge summary.
   *
   * Returns null if there are still pending items.
   */
  async finalize(scanId: string): Promise<ReviewFinalizeResult | null> {
    const scan = this.scanRepo.findById(scanId);
    if (!scan) throw new Error(`Scan not found: ${scanId}`);
    const pending = this.reviewRepo.listPendingByScan(scanId);
    if (pending.length > 0) return null;

    const all = this.reviewRepo.listByScan(scanId);
    const approved = all.filter((i) => i.status === 'approved');
    const projectRoot = this.deps.getProjectRoot(scan.projectId);

    // Group by capability, build a delta containing only the approved entries.
    const byCapability = new Map<string, DeltaDoc>();
    for (const item of approved) {
      let delta = byCapability.get(item.capability);
      if (!delta) {
        delta = { added: [], modified: [], removed: [] };
        byCapability.set(item.capability, delta);
      }
      if (item.operation === 'modify') {
        const req = JSON.parse(item.payloadJson) as ParsedRequirement;
        delta.modified.push(req);
      } else {
        const obj = JSON.parse(item.payloadJson) as { name: string };
        delta.removed.push(obj.name);
      }
    }

    const mergedSummary: Record<string, { modified: number; removed: number }> = {};
    for (const [capability, delta] of byCapability) {
      const corpus = readOrEmptyCorpus(projectRoot, capability);
      const merge = applyDelta(corpus, delta);
      writeCorpus(projectRoot, capability, merge.spec);
      mergedSummary[capability] = { modified: merge.modified.length, removed: merge.removed.length };
    }

    const updated = this.scanRepo.update(scanId, {
      status: 'completed',
      finishedAt: Date.now(),
      pendingCount: 0,
    });
    bumpCorpusMeta(this.deps.db, scan.projectId);
    return { scan: updated, mergedSummary };
  }
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
