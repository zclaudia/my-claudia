/**
 * Skill Selector — chooses which skills to inject into system prompt
 * based on context (user input keywords, project type, environment).
 */

import { execFileSync } from 'child_process';
import type { SkillMeta } from './skill-tools.js';

export interface SkillSelectorContext {
  userInput?: string;
  projectType?: string;
  os?: string;
}

const binaryCache = new Map<string, boolean>();

function isBinaryAvailable(name: string): boolean {
  if (binaryCache.has(name)) {
    return binaryCache.get(name) ?? false;
  }

  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    binaryCache.set(name, true);
    return true;
  } catch {
    binaryCache.set(name, false);
    return false;
  }
}

const OS_ALIASES: Record<string, string> = {
  macos: 'darwin',
  mac: 'darwin',
  windows: 'win32',
  linux: 'linux',
  darwin: 'darwin',
  win32: 'win32',
};

function meetsRequirements(skill: SkillMeta, ctx: SkillSelectorContext): boolean {
  const requirements = skill.requires;
  if (!requirements) {
    return true;
  }

  if (requirements.os && requirements.os.length > 0) {
    const currentOs = ctx.os || process.platform;
    const normalizedRequired = requirements.os.map((os) => OS_ALIASES[os.toLowerCase()] || os.toLowerCase());
    if (!normalizedRequired.includes(currentOs)) {
      return false;
    }
  }

  if (requirements.binaries && requirements.binaries.length > 0) {
    for (const binary of requirements.binaries) {
      if (!isBinaryAvailable(binary)) {
        return false;
      }
    }
  }

  if (requirements.env && requirements.env.length > 0) {
    for (const envVar of requirements.env) {
      if (!process.env[envVar]) {
        return false;
      }
    }
  }

  return true;
}

function matchesTriggers(skill: SkillMeta, ctx: SkillSelectorContext): boolean {
  const triggers = skill.triggers;
  if (!triggers) {
    return false;
  }

  let matched = false;

  if (triggers.keywords && triggers.keywords.length > 0 && ctx.userInput) {
    const inputLower = ctx.userInput.toLowerCase();
    matched = triggers.keywords.some((keyword) => inputLower.includes(keyword.toLowerCase()));
  }

  if (!matched && triggers.projectType && triggers.projectType.length > 0 && ctx.projectType) {
    matched = triggers.projectType.includes(ctx.projectType);
  }

  return matched;
}

export function selectSkills(
  allSkills: SkillMeta[],
  ctx: SkillSelectorContext,
  maxCount = 5,
): SkillMeta[] {
  return allSkills
    .filter((skill) => meetsRequirements(skill, ctx))
    .filter((skill) => matchesTriggers(skill, ctx))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxCount);
}
