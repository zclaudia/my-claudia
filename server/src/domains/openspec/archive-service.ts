// server/src/domains/openspec/archive-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import { SpecChangeRepository } from '../spec-change/spec-change-repository.js';
import { parseSpec } from './markdown/spec-parser.js';
import { parseDelta } from './markdown/delta-parser.js';
import { formatSpec } from './markdown/spec-formatter.js';
import { applyDelta, type MergeResult } from './delta-merger.js';
import { validateDelta } from './validator.js';

const OPENSPEC_DIR = 'openspec';
const SPECS_DIR = 'specs';
const CHANGES_DIR = 'changes';
const ARCHIVE_DIR = 'archive';

export interface ArchiveServiceDeps {
  db: Database;
  getProjectRoot: (projectId: string) => string;
}

export interface CapabilityArchiveSummary {
  capability: string;
  added: string[];
  modified: string[];
  removed: string[];
  addedConflicts: string[];
  modifiedMissing: string[];
  removedMissing: string[];
}

export interface ArchiveResult {
  ok: boolean;
  /** Per-capability summary; empty if validation failed before merge. */
  capabilities: CapabilityArchiveSummary[];
  /** Validation errors (only present when ok=false). */
  validationErrors: { capability: string; issues: string[] }[];
  archivedDir?: string;
}

export class ArchiveService {
  private repo: SpecChangeRepository;

  constructor(private deps: ArchiveServiceDeps) {
    this.repo = new SpecChangeRepository(deps.db);
  }

  async archive(specChangeId: string): Promise<ArchiveResult> {
    const sc = this.repo.findById(specChangeId);
    if (!sc) throw new Error(`SpecChange not found: ${specChangeId}`);

    const projectRoot = this.deps.getProjectRoot(sc.projectId);
    const changeDir = path.join(projectRoot, OPENSPEC_DIR, CHANGES_DIR, sc.slug);
    const specsRoot = path.join(projectRoot, OPENSPEC_DIR, SPECS_DIR);

    // 1. Discover delta files: from sc.deltaSpecPaths if non-empty; else scan the dir.
    const deltaFiles = await this.findDeltaFiles(changeDir, sc.deltaSpecPaths);

    // 2. Parse + validate ALL deltas first; abort on any validation error.
    const parsed = deltaFiles.map((f) => ({
      capability: f.capability,
      delta: parseDelta(fs.readFileSync(f.absPath, 'utf-8')),
    }));

    const validationErrors = parsed
      .map((p) => ({ capability: p.capability, result: validateDelta(p.delta) }))
      .filter((r) => !r.result.ok)
      .map((r) => ({
        capability: r.capability,
        issues: r.result.issues
          .filter((i) => i.severity === 'error')
          .map((i) => `${i.location}: ${i.message}`),
      }));

    if (validationErrors.length > 0) {
      return { ok: false, capabilities: [], validationErrors };
    }

    // 3. Apply each delta to the corresponding corpus spec.
    const capabilities: CapabilityArchiveSummary[] = [];
    for (const { capability, delta } of parsed) {
      const corpusFile = path.join(specsRoot, capability, 'spec.md');
      const corpusSpec = fs.existsSync(corpusFile)
        ? parseSpec(fs.readFileSync(corpusFile, 'utf-8'))
        : { capability, requirements: [] };
      const merge: MergeResult = applyDelta(corpusSpec, delta);
      fs.mkdirSync(path.dirname(corpusFile), { recursive: true });
      fs.writeFileSync(corpusFile, formatSpec(merge.spec));
      capabilities.push({
        capability,
        added: merge.added,
        modified: merge.modified,
        removed: merge.removed,
        addedConflicts: merge.addedConflicts,
        modifiedMissing: merge.modifiedMissing,
        removedMissing: merge.removedMissing,
      });
    }

    // 4. Move change dir under archive/.
    const today = new Date().toISOString().slice(0, 10);
    const archiveRoot = path.join(projectRoot, OPENSPEC_DIR, CHANGES_DIR, ARCHIVE_DIR);
    fs.mkdirSync(archiveRoot, { recursive: true });
    const archivedDir = path.join(archiveRoot, `${today}-${sc.slug}`);
    if (fs.existsSync(changeDir)) {
      fs.renameSync(changeDir, archivedDir);
    }

    // 5. Mark spec_change as archived.
    this.repo.update(specChangeId, {
      status: 'archived',
      deltaPendingMerge: false,
      archivedAt: Date.now(),
    });

    return { ok: true, capabilities, validationErrors: [], archivedDir };
  }

  private async findDeltaFiles(
    changeDir: string,
    _knownPaths: string[],
  ): Promise<{ capability: string; absPath: string }[]> {
    const found: { capability: string; absPath: string }[] = [];
    const specsDir = path.join(changeDir, 'specs');
    if (!fs.existsSync(specsDir)) return found;

    // Walk one level: openspec/changes/<slug>/specs/<capability>/spec.md
    for (const entry of fs.readdirSync(specsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cap = entry.name;
      const specFile = path.join(specsDir, cap, 'spec.md');
      if (fs.existsSync(specFile)) {
        found.push({ capability: cap, absPath: specFile });
      }
    }
    return found;
  }
}
