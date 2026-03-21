/**
 * Skill Tools - Registers workspace and external skills as MCP bridge tools.
 *
 * Skills are discovered from:
 * 1. Workspace skills directory (~/.my-claudia/workspace/skills/)
 * 2. External skill directories (configured via app_config 'skill_extra_dirs')
 *
 * Each skill with a valid SKILL.md is registered as a tool with prefix `skill__`.
 * AI providers call these tools on demand to load full skill content (lazy loading).
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { toolRegistry } from './tool-registry.js';
import { workspaceService } from '../services/workspace.js';
import type Database from 'better-sqlite3';

// ============================================
// Types
// ============================================

interface SkillTriggers {
  keywords?: string[];
  projectType?: string[];
}

interface SkillRequires {
  os?: string[];
  binaries?: string[];
  env?: string[];
}

interface SkillMeta {
  id: string;
  name: string;
  description: string;
  /** Absolute path to the skill directory (containing SKILL.md) */
  dirPath: string;
  source: 'workspace' | 'external';
  // Phase 3 fields
  triggers?: SkillTriggers;
  requires?: SkillRequires;
  priority: number;  // lower = higher priority, default 100
}

export type { SkillMeta };

// ============================================
// Constants
// ============================================

const MAX_SKILL_CONTENT_SIZE = 50 * 1024; // 50KB per skill response
const MAX_RECURSION_DEPTH = 5; // Maximum directory nesting depth for skill discovery
const TOOL_PREFIX = 'skill__';

// ============================================
// Module state
// ============================================

let _db: Database.Database | null = null;
let _discoveredSkills: SkillMeta[] = [];

export function setDatabase(db: Database.Database): void {
  _db = db;
}

/** Get all currently discovered skills (for Skill Selector) */
export function getDiscoveredSkills(): SkillMeta[] {
  return _discoveredSkills;
}

// ============================================
// SKILL.md frontmatter parsing
// ============================================

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Expects: ---\nname: ...\ndescription: ...\n---\n
 */
interface ParsedFrontmatter {
  name?: string;
  description?: string;
  triggers?: SkillTriggers;
  requires?: SkillRequires;
  priority?: number;
}

interface ParsedSkillFile {
  frontmatter: ParsedFrontmatter;
  body: string;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return [value];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is string => typeof item === 'string');
  return values.length > 0 ? values : undefined;
}

export function parseSkillFile(content: string): ParsedSkillFile {
  try {
    const parsed = matter(content);
    const data = toRecord(parsed.data) ?? {};

    const frontmatter: ParsedFrontmatter = {
      name: typeof data.name === 'string' ? data.name : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
      priority: typeof data.priority === 'number' && Number.isFinite(data.priority)
        ? data.priority
        : undefined,
    };

    const triggerData = toRecord(data.triggers);
    if (triggerData) {
      const triggers: SkillTriggers = {};
      const keywords = toStringArray(triggerData.keywords);
      const projectType = toStringArray(triggerData.projectType);
      if (keywords) triggers.keywords = keywords;
      if (projectType) triggers.projectType = projectType;
      if (triggers.keywords || triggers.projectType) {
        frontmatter.triggers = triggers;
      }
    }

    const requiresData = toRecord(data.requires);
    if (requiresData) {
      const requires: SkillRequires = {};
      const os = toStringArray(requiresData.os);
      const binaries = toStringArray(requiresData.binaries);
      const env = toStringArray(requiresData.env);
      if (os) requires.os = os;
      if (binaries) requires.binaries = binaries;
      if (env) requires.env = env;
      if (requires.os || requires.binaries || requires.env) {
        frontmatter.requires = requires;
      }
    }

    return {
      frontmatter,
      body: parsed.content,
    };
  } catch {
    return {
      frontmatter: {},
      body: content,
    };
  }
}

// ============================================
// Skill discovery
// ============================================

/**
 * Recursively discover skills in a directory.
 * A directory with SKILL.md is a skill.
 * A directory without SKILL.md is a category folder — recurse into it.
 * @param maxDepth Maximum recursion depth (default: MAX_RECURSION_DEPTH)
 */
function discoverSkillsInDir(
  dir: string,
  source: 'workspace' | 'external',
  maxDepth: number = MAX_RECURSION_DEPTH,
): SkillMeta[] {
  const skills: SkillMeta[] = [];

  if (maxDepth <= 0) {
    console.warn(`[SkillTools] Max recursion depth reached, skipping: ${dir}`);
    return skills;
  }

  if (!fs.existsSync(dir)) return skills;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const subdir = path.join(dir, entry.name);
    const skillMdPath = path.join(subdir, 'SKILL.md');

    if (fs.existsSync(skillMdPath)) {
      // This is a skill directory
      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillFile(content);
        const fm = parsed.frontmatter;
        // Fallback: extract name from first heading, description from second line
        const lines = parsed.body.split('\n').filter(l => l.trim());
        const name = fm.name || lines[0]?.replace(/^#\s*/, '') || entry.name;
        const description = fm.description || lines[1]?.replace(/^>\s*/, '') || '';

        skills.push({
          id: entry.name,
          name,
          description,
          dirPath: subdir,
          source,
          triggers: fm.triggers,
          requires: fm.requires,
          priority: fm.priority ?? 100,
        });
      } catch {
        // Skip unreadable skills
      }
    } else {
      // No SKILL.md — treat as category folder, recurse with decremented depth
      skills.push(...discoverSkillsInDir(subdir, source, maxDepth - 1));
    }
  }

  return skills;
}

/**
 * Load full skill content: SKILL.md + all files under references/.
 * Truncates to MAX_SKILL_CONTENT_SIZE.
 */
export function loadSkillContent(dirPath: string): string {
  const parts: string[] = [];

  // Main SKILL.md
  const skillMdPath = path.join(dirPath, 'SKILL.md');
  try {
    parts.push(fs.readFileSync(skillMdPath, 'utf-8'));
  } catch {
    return `Skill file not found: ${skillMdPath}`;
  }

  // References
  const refsDir = path.join(dirPath, 'references');
  if (fs.existsSync(refsDir)) {
    try {
      const refEntries = fs.readdirSync(refsDir, { withFileTypes: true });
      for (const ref of refEntries) {
        if (!ref.isFile() || !ref.name.endsWith('.md')) continue;
        try {
          const refContent = fs.readFileSync(path.join(refsDir, ref.name), 'utf-8');
          parts.push(`\n---\n## Reference: ${ref.name}\n\n${refContent}`);
        } catch {
          // Skip unreadable reference files
        }
      }
    } catch {
      // References dir unreadable
    }
  }

  const combined = parts.join('\n');
  if (combined.length > MAX_SKILL_CONTENT_SIZE) {
    return combined.slice(0, MAX_SKILL_CONTENT_SIZE) + '\n\n[Content truncated at 50KB limit]';
  }
  return combined;
}

// ============================================
// External skill dirs config (from DB)
// ============================================

export function getExternalSkillDirs(): string[] {
  if (!_db) return [];
  try {
    const row = _db.prepare(
      `SELECT value FROM app_config WHERE key = 'skill_extra_dirs'`
    ).get() as { value: string } | undefined;
    if (!row) return [];
    const dirs = JSON.parse(row.value);
    return Array.isArray(dirs) ? dirs : [];
  } catch {
    return [];
  }
}

export function saveExternalSkillDirs(dirs: string[]): void {
  if (!_db) return;
  _db.prepare(`
    INSERT INTO app_config (key, value) VALUES ('skill_extra_dirs', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(dirs));
}

// ============================================
// Registration
// ============================================

/**
 * Discover all skills and register them as tools in the tool registry.
 */
export async function registerSkillTools(): Promise<number> {
  const allSkills: SkillMeta[] = [];
  const seenIds = new Set<string>();

  // 1. Workspace skills
  const workspaceSkillsDir = path.join(workspaceService.getWorkspaceDir(), 'skills');
  for (const skill of discoverSkillsInDir(workspaceSkillsDir, 'workspace')) {
    if (!seenIds.has(skill.id)) {
      seenIds.add(skill.id);
      allSkills.push(skill);
    }
  }

  // 2. External skill directories
  for (const dir of getExternalSkillDirs()) {
    for (const skill of discoverSkillsInDir(dir, 'external')) {
      if (!seenIds.has(skill.id)) {
        seenIds.add(skill.id);
        allSkills.push(skill);
      }
    }
  }

  // Register each skill as a tool
  for (const skill of allSkills) {
    const toolId = `${TOOL_PREFIX}${skill.id}`;
    toolRegistry.register({
      id: toolId,
      definition: {
        type: 'function',
        function: {
          name: toolId,
          description: `[Skill] ${skill.name}: ${skill.description}`,
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'What you want to accomplish with this skill (optional context)',
              },
            },
          },
        },
      },
      source: 'skill',
      handler: async () => {
        return loadSkillContent(skill.dirPath);
      },
    });
  }

  _discoveredSkills = allSkills;

  if (allSkills.length > 0) {
    console.log(`[SkillTools] Registered ${allSkills.length} skill(s): ${allSkills.map(s => s.id).join(', ')}`);
  }

  return allSkills.length;
}

/**
 * Clear all skill tools and re-register from disk.
 */
export async function refreshSkillTools(): Promise<number> {
  toolRegistry.removeBySource('skill');
  return registerSkillTools();
}

/**
 * Build a lightweight skill directory for system prompt injection.
 * Lists skill name + description only (no content).
 */
export function buildSkillDirectoryHint(): string {
  const skillTools = toolRegistry.getAll().filter(t => t.source === 'skill');
  if (skillTools.length === 0) return '';

  const lines = skillTools.map(t => {
    const fn = t.definition.function;
    return `- ${fn.name}: ${fn.description?.replace(/^\[Skill\]\s*/, '') || ''}`;
  });

  return [
    '## Available Skills',
    '',
    'Call the corresponding tool to load full instructions:',
    ...lines,
  ].join('\n');
}
