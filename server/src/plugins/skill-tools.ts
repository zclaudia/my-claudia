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
import { toolRegistry } from './tool-registry.js';
import { workspaceService } from '../services/workspace.js';
import type Database from 'better-sqlite3';

// ============================================
// Types
// ============================================

interface SkillMeta {
  id: string;
  name: string;
  description: string;
  /** Absolute path to the skill directory (containing SKILL.md) */
  dirPath: string;
  source: 'workspace' | 'external';
}

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

export function setDatabase(db: Database.Database): void {
  _db = db;
}

// ============================================
// SKILL.md frontmatter parsing
// ============================================

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Expects: ---\nname: ...\ndescription: ...\n---\n
 */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key && value) {
      result[key] = value;
    }
  }

  return { name: result.name, description: result.description };
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
        const fm = parseFrontmatter(content);
        // Fallback: extract name from first heading, description from second line
        const lines = content.replace(/^---[\s\S]*?---\s*\n?/, '').split('\n').filter(l => l.trim());
        const name = fm.name || lines[0]?.replace(/^#\s*/, '') || entry.name;
        const description = fm.description || lines[1]?.replace(/^>\s*/, '') || '';

        skills.push({
          id: entry.name,
          name,
          description,
          dirPath: subdir,
          source,
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
function loadSkillContent(dirPath: string): string {
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
