/**
 * Skill Selector — chooses which skills to inject into system prompt
 * based on context (user input keywords, project type, environment).
 */

import type { SkillMeta } from './skill-tools.js';
import { execFileSync } from 'child_process';

export interface SkillSelectorContext {
  userInput?: string;
  projectType?: string;
  os?: string;            // defaults to process.platform
}

const binaryCache = new Map<string, boolean>();

function isBinaryAvailable(name: string): boolean {
  if (binaryCache.has(name)) return binaryCache.get(name)!;
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    binaryCache.set(name, true);
    return true;
  } catch {
    binaryCache.set(name, false);
    return false;
  }
}

function meetsRequirements(skill: SkillMeta, ctx: SkillSelectorContext): boolean {
  const req = skill.requires;
  if (!req) return true;

  // OS check
  if (req.os && req.os.length > 0) {
    const currentOs = ctx.os || process.platform;
    if (!req.os.includes(currentOs)) return false;
  }

  // Binary check
  if (req.binaries && req.binaries.length > 0) {
    for (const bin of req.binaries) {
      if (!isBinaryAvailable(bin)) return false;
    }
  }

  // Env check
  if (req.env && req.env.length > 0) {
    for (const envVar of req.env) {
      if (!process.env[envVar]) return false;
    }
  }

  return true;
}

function matchesTriggers(skill: SkillMeta, ctx: SkillSelectorContext): boolean {
  const triggers = skill.triggers;
  if (!triggers) return false; // No triggers = only available on-demand via tool call

  let matched = false;

  // Keyword matching (case-insensitive)
  if (triggers.keywords && triggers.keywords.length > 0 && ctx.userInput) {
    const inputLower = ctx.userInput.toLowerCase();
    matched = triggers.keywords.some(kw => inputLower.includes(kw.toLowerCase()));
  }

  // Project type matching
  if (!matched && triggers.projectType && triggers.projectType.length > 0 && ctx.projectType) {
    matched = triggers.projectType.includes(ctx.projectType);
  }

  return matched;
}

/**
 * Select skills to proactively inject into system prompt.
 * Only returns skills that:
 * 1. Meet environment requirements (OS, binaries, env vars)
 * 2. Match at least one trigger (keywords or project type)
 *
 * Skills without triggers are never auto-injected (they're available as tools).
 */
export function selectSkills(
  allSkills: SkillMeta[],
  ctx: SkillSelectorContext,
  maxCount = 5,
): SkillMeta[] {
  return allSkills
    .filter(s => meetsRequirements(s, ctx))
    .filter(s => matchesTriggers(s, ctx))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxCount);
}
