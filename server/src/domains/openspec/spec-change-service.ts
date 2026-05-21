// server/src/domains/openspec/spec-change-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type {
  SpecChange,
  SpecChangeStatus,
} from '@my-claudia/shared/features/spec-change';
import { SpecChangeRepository } from '../spec-change/spec-change-repository.js';

const OPENSPEC_DIR = 'openspec';
const CHANGES_DIR = 'changes';

export interface SpecChangeServiceDeps {
  db: Database;
  /** Resolve a project's filesystem root (working tree). */
  getProjectRoot: (projectId: string) => string;
}

export interface CreateSpecChangeInput {
  projectId: string;
  subIssueId: string;
  slug: string;
  title: string;
}

const SKELETON_PROPOSAL = '# Proposal\n\n## Why\n\n## What Changes\n\n## Impact\n';
const SKELETON_DESIGN = '# Design\n\n## Overview\n\n## Technical Approach\n\n## Risks\n';
const SKELETON_TASKS = '# Tasks\n\n- [ ] Task 1\n';

export class SpecChangeService {
  private repo: SpecChangeRepository;

  constructor(private deps: SpecChangeServiceDeps) {
    this.repo = new SpecChangeRepository(deps.db);
  }

  createSpecChange(input: CreateSpecChangeInput): SpecChange {
    const sc = this.repo.create({
      projectId: input.projectId,
      subIssueId: input.subIssueId,
      slug: input.slug,
      title: input.title,
    });
    // Scaffold files on disk.
    const dir = this.changeDir(input.projectId, input.slug);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, 'proposal.md'))) fs.writeFileSync(path.join(dir, 'proposal.md'), SKELETON_PROPOSAL);
    if (!fs.existsSync(path.join(dir, 'design.md')))   fs.writeFileSync(path.join(dir, 'design.md'),   SKELETON_DESIGN);
    if (!fs.existsSync(path.join(dir, 'tasks.md')))    fs.writeFileSync(path.join(dir, 'tasks.md'),    SKELETON_TASKS);
    return sc;
  }

  writeProposal(specChangeId: string, content: string): SpecChange {
    return this.writeArtifact(specChangeId, 'proposal.md', content, 'proposing');
  }

  writeDesign(specChangeId: string, content: string): SpecChange {
    return this.writeArtifact(specChangeId, 'design.md', content, 'designing');
  }

  writeTasks(specChangeId: string, content: string): SpecChange {
    return this.writeArtifact(specChangeId, 'tasks.md', content, 'tasks_ready');
  }

  /** Write or overwrite a delta spec file for a given capability. */
  writeDeltaSpec(specChangeId: string, capability: string, content: string): SpecChange {
    const sc = this.requireChange(specChangeId);
    const rel = path.join('specs', capability, 'spec.md');
    const target = path.join(this.changeDir(sc.projectId, sc.slug), rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);

    const fullRel = path.join(OPENSPEC_DIR, CHANGES_DIR, sc.slug, rel);
    const next = sc.deltaSpecPaths.includes(fullRel)
      ? sc.deltaSpecPaths
      : [...sc.deltaSpecPaths, fullRel];
    return this.repo.update(specChangeId, { deltaSpecPaths: next });
  }

  readProposal(specChangeId: string): string {
    return this.readArtifact(specChangeId, 'proposal.md');
  }

  readDesign(specChangeId: string): string {
    return this.readArtifact(specChangeId, 'design.md');
  }

  readTasks(specChangeId: string): string {
    return this.readArtifact(specChangeId, 'tasks.md');
  }

  readDeltaSpec(specChangeId: string, capability: string): string {
    const sc = this.requireChange(specChangeId);
    const target = path.join(this.changeDir(sc.projectId, sc.slug), 'specs', capability, 'spec.md');
    return fs.readFileSync(target, 'utf-8');
  }

  cancel(specChangeId: string): SpecChange {
    return this.repo.update(specChangeId, { status: 'cancelled' });
  }

  getById(specChangeId: string): SpecChange | null {
    return this.repo.findById(specChangeId);
  }

  /** Internal helpers */

  private writeArtifact(specChangeId: string, filename: 'proposal.md' | 'design.md' | 'tasks.md', content: string, nextStatus: SpecChangeStatus): SpecChange {
    const sc = this.requireChange(specChangeId);
    const target = path.join(this.changeDir(sc.projectId, sc.slug), filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    // Only advance status if it's a strictly later state.
    const order: SpecChangeStatus[] = ['drafting', 'proposing', 'designing', 'tasks_ready'];
    const currentIdx = order.indexOf(sc.status);
    const nextIdx = order.indexOf(nextStatus);
    const status = (currentIdx >= 0 && nextIdx > currentIdx) ? nextStatus : sc.status;
    return this.repo.update(specChangeId, { status });
  }

  private readArtifact(specChangeId: string, filename: string): string {
    const sc = this.requireChange(specChangeId);
    const target = path.join(this.changeDir(sc.projectId, sc.slug), filename);
    return fs.readFileSync(target, 'utf-8');
  }

  private requireChange(specChangeId: string): SpecChange {
    const sc = this.repo.findById(specChangeId);
    if (!sc) throw new Error(`SpecChange not found: ${specChangeId}`);
    return sc;
  }

  private changeDir(projectId: string, slug: string): string {
    return path.join(this.deps.getProjectRoot(projectId), OPENSPEC_DIR, CHANGES_DIR, slug);
  }
}
