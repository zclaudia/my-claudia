// server/src/domains/openspec/spec-change-drafting-service.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { AiRunPort } from '../meta-workflow/run-entities/subagent-run-entity.js';
import { SpecChangeRepository } from '../spec-change/spec-change-repository.js';
import { LocalIssueRepository } from '../local-issues/repository.js';
import { parseSpec } from './markdown/spec-parser.js';

const OPENSPEC_DIR = 'openspec';

export interface SpecChangeDraftingServiceDeps {
  db: Database;
  aiRunPort: AiRunPort;
  getProjectRoot: (projectId: string) => string;
  /** Total time to wait for AI completion before resolving with partial output. Default 120s. */
  timeoutMs?: number;
  /** Optional providerId override passed straight to aiRunPort. */
  providerId?: string;
}

export interface DraftResult {
  content: string;
  /** Raw AI response (for debugging / logging). */
  rawResponse: string;
}

/**
 * Service that asks the AI to draft an OpenSpec artifact (proposal / design /
 * tasks / per-capability delta) for a given spec_change. Each method is pure
 * with respect to disk — callers (typically REST handlers) decide whether to
 * persist the returned content via SpecChangeService.write*.
 */
export class SpecChangeDraftingService {
  private specChangeRepo: SpecChangeRepository;
  private issueRepo: LocalIssueRepository;

  constructor(private deps: SpecChangeDraftingServiceDeps) {
    this.specChangeRepo = new SpecChangeRepository(deps.db);
    this.issueRepo = new LocalIssueRepository(deps.db);
  }

  async draftProposal(specChangeId: string): Promise<DraftResult> {
    const ctx = this.loadContext(specChangeId);
    const prompt = buildProposalPrompt(ctx);
    return this.run(prompt, ctx.projectRoot);
  }

  async draftDesign(specChangeId: string): Promise<DraftResult> {
    const ctx = this.loadContext(specChangeId);
    const proposal = this.readArtifactSafe(ctx.projectRoot, ctx.slug, 'proposal.md');
    const prompt = buildDesignPrompt({ ...ctx, proposal });
    return this.run(prompt, ctx.projectRoot);
  }

  async draftTasks(specChangeId: string): Promise<DraftResult> {
    const ctx = this.loadContext(specChangeId);
    const design = this.readArtifactSafe(ctx.projectRoot, ctx.slug, 'design.md');
    const prompt = buildTasksPrompt({ ...ctx, design });
    return this.run(prompt, ctx.projectRoot);
  }

  async draftDelta(specChangeId: string, capability: string): Promise<DraftResult> {
    const ctx = this.loadContext(specChangeId);
    const proposal = this.readArtifactSafe(ctx.projectRoot, ctx.slug, 'proposal.md');
    const design = this.readArtifactSafe(ctx.projectRoot, ctx.slug, 'design.md');
    const corpusFile = path.join(
      ctx.projectRoot,
      OPENSPEC_DIR,
      'specs',
      capability,
      'spec.md',
    );
    const existingCorpus = fs.existsSync(corpusFile)
      ? fs.readFileSync(corpusFile, 'utf-8')
      : null;
    const corpusSummary = existingCorpus
      ? summarizeCapability(existingCorpus)
      : '(capability does not yet exist in corpus)';
    const prompt = buildDeltaPrompt({
      ...ctx,
      proposal,
      design,
      capability,
      corpusSummary,
    });
    return this.run(prompt, ctx.projectRoot);
  }

  // ── Internals ──────────────────────────────────────────────────

  private loadContext(specChangeId: string): {
    specChangeId: string;
    projectId: string;
    projectRoot: string;
    slug: string;
    issueTitle: string;
    issueDescription: string | undefined;
    issueType: string;
  } {
    const sc = this.specChangeRepo.findById(specChangeId);
    if (!sc) throw new Error(`SpecChange not found: ${specChangeId}`);
    const issue = this.issueRepo.findById(sc.subIssueId);
    if (!issue) throw new Error(`Sub-issue not found for spec_change: ${sc.subIssueId}`);
    return {
      specChangeId: sc.id,
      projectId: sc.projectId,
      projectRoot: this.deps.getProjectRoot(sc.projectId),
      slug: sc.slug,
      issueTitle: issue.title,
      issueDescription: issue.description,
      issueType: issue.type,
    };
  }

  private readArtifactSafe(
    projectRoot: string,
    slug: string,
    name: 'proposal.md' | 'design.md' | 'tasks.md',
  ): string {
    const file = path.join(projectRoot, OPENSPEC_DIR, 'changes', slug, name);
    if (!fs.existsSync(file)) return '(not yet written)';
    return fs.readFileSync(file, 'utf-8');
  }

  private async run(prompt: string, workingDirectory: string): Promise<DraftResult> {
    let collected = '';
    let resolved = false;
    const timeoutMs = this.deps.timeoutMs ?? 120_000;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, timeoutMs);
      this.deps.aiRunPort
        .startVirtualRun({
          input: prompt,
          workingDirectory,
          providerId: this.deps.providerId,
          onMessage: (m) => {
            if (m.content) collected += m.content;
            if (
              m.kind === 'run_completed' ||
              m.kind === 'completed' ||
              m.kind === 'final'
            ) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve();
              }
            }
          },
        })
        .catch(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve();
          }
        });
    });

    const content = stripPreamble(collected);
    return { content, rawResponse: collected };
  }
}

// ── Prompt builders ───────────────────────────────────────────────

interface BaseCtx {
  issueTitle: string;
  issueDescription?: string;
  issueType: string;
  slug: string;
}

export function buildProposalPrompt(ctx: BaseCtx): string {
  return [
    `You are drafting a proposal.md for an OpenSpec change.`,
    ``,
    `# Sub-Issue`,
    `- Type: ${ctx.issueType}`,
    `- Title: ${ctx.issueTitle}`,
    ctx.issueDescription
      ? `- Description: ${ctx.issueDescription}`
      : `- Description: (none provided)`,
    `- Slug: ${ctx.slug}`,
    ``,
    `# Task`,
    `Draft a complete proposal.md in this exact structure:`,
    ``,
    `\`\`\`markdown`,
    `# Proposal: ${ctx.issueTitle}`,
    ``,
    `## Why`,
    `<one-paragraph motivation grounded in the sub-issue title + description>`,
    ``,
    `## What Changes`,
    `<bulleted list of user-visible or behavior-visible changes>`,
    ``,
    `## Impact`,
    `<who/what is affected; which capabilities are touched>`,
    ``,
    `## Out of Scope`,
    `<explicit non-goals>`,
    `\`\`\``,
    ``,
    `Output ONLY the markdown — no commentary, no code fences around it, no leading explanation.`,
  ].join('\n');
}

export function buildDesignPrompt(ctx: BaseCtx & { proposal: string }): string {
  return [
    `You are drafting design.md for an OpenSpec change, given the proposal.`,
    ``,
    `# Proposal context`,
    `\`\`\`markdown`,
    ctx.proposal,
    `\`\`\``,
    ``,
    `# Task`,
    `Draft a complete design.md in this structure:`,
    ``,
    `\`\`\`markdown`,
    `# Design: ${ctx.issueTitle}`,
    ``,
    `## Overview`,
    `<2-3 sentences technical summary>`,
    ``,
    `## Technical Approach`,
    `<concrete approach; data model changes; APIs; algorithms>`,
    ``,
    `## Risks`,
    `<known risks + mitigation per risk>`,
    ``,
    `## Testing Strategy`,
    `<unit / integration / manual test coverage>`,
    `\`\`\``,
    ``,
    `Output ONLY the markdown — no commentary, no outer code fence.`,
  ].join('\n');
}

export function buildTasksPrompt(ctx: BaseCtx & { design: string }): string {
  return [
    `You are drafting tasks.md for an OpenSpec change, given the design.`,
    ``,
    `# Design context`,
    `\`\`\`markdown`,
    ctx.design,
    `\`\`\``,
    ``,
    `# Task`,
    `Draft a complete tasks.md as a checklist. Each task should be a concrete actionable step (file to create/modify, test to write, command to run). Use this structure:`,
    ``,
    `\`\`\`markdown`,
    `# Tasks: ${ctx.issueTitle}`,
    ``,
    `- [ ] <Concrete task 1>`,
    `- [ ] <Concrete task 2>`,
    `- [ ] ...`,
    `\`\`\``,
    ``,
    `Aim for 4-10 tasks. Each should be implementable in 30 minutes or less. Output ONLY the markdown — no commentary.`,
  ].join('\n');
}

export function buildDeltaPrompt(
  ctx: BaseCtx & {
    proposal: string;
    design: string;
    capability: string;
    corpusSummary: string;
  },
): string {
  return [
    `You are drafting a delta spec for the capability "${ctx.capability}" in OpenSpec format.`,
    ``,
    `# Existing capability in corpus`,
    ctx.corpusSummary,
    ``,
    `# Proposal context`,
    `\`\`\`markdown`,
    ctx.proposal,
    `\`\`\``,
    ``,
    `# Design context`,
    `\`\`\`markdown`,
    ctx.design,
    `\`\`\``,
    ``,
    `# Task`,
    `Draft a delta spec describing how "${ctx.capability}" changes. Use OpenSpec's delta format with ADDED / MODIFIED / REMOVED sections. Each requirement must:`,
    `- Use the OpenSpec heading format: \`### Requirement: <name>\``,
    `- Have a body using MUST / SHOULD / SHALL / MAY (RFC 2119 keywords)`,
    `- Have at least one \`#### Scenario: <name>\` block with bulleted "- **WHEN** ..." / "- **THEN** ..." lines`,
    ``,
    `Structure:`,
    `\`\`\`markdown`,
    `## Purpose`,
    `<change-specific description of why this capability is being changed>`,
    ``,
    `## ADDED Requirements`,
    `### Requirement: <new requirement>`,
    `<body with RFC keyword>`,
    ``,
    `#### Scenario: <scenario name>`,
    `- **WHEN** ...`,
    `- **THEN** ...`,
    ``,
    `## MODIFIED Requirements`,
    `<only requirements that already exist in corpus and need behavior change>`,
    ``,
    `## REMOVED Requirements`,
    `- \`<existing requirement name to remove>\``,
    `\`\`\``,
    ``,
    `Only include section headers that have content (omit empty MODIFIED/REMOVED sections). Output ONLY the markdown — no commentary.`,
  ].join('\n');
}

// ── Helpers ──────────────────────────────────────────────────────

function stripPreamble(raw: string): string {
  // AI sometimes wraps output in ```markdown ... ``` even when told not to.
  // Strip the leading code-fence block when the entire response is one fence.
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim() + '\n';
  return trimmed.endsWith('\n') ? trimmed : trimmed + '\n';
}

function summarizeCapability(corpusMarkdown: string): string {
  const parsed = parseSpec(corpusMarkdown);
  const lines: string[] = [`Capability: ${parsed.capability}`];
  if (parsed.purpose) lines.push(`Purpose: ${parsed.purpose}`);
  lines.push(`Existing requirements (${parsed.requirements.length}):`);
  for (const r of parsed.requirements) {
    lines.push(
      `- ${r.name}${r.scenarios.length > 0 ? ` (${r.scenarios.length} scenarios)` : ''}`,
    );
  }
  return lines.join('\n');
}
