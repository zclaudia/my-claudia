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
import type Database from 'better-sqlite3';
import matter from 'gray-matter';
import { workspaceService } from '../../services/workspace.js';
import { toolRegistry } from './tool-registry.js';

interface SkillTriggers {
  keywords?: string[];
  projectType?: string[];
}

interface SkillRequires {
  os?: string[];
  binaries?: string[];
  env?: string[];
}

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  dirPath: string;
  source: 'workspace' | 'external';
  triggers?: SkillTriggers;
  requires?: SkillRequires;
  priority: number;
}

const MAX_SKILL_CONTENT_SIZE = 50 * 1024;
const MAX_RECURSION_DEPTH = 5;
const TOOL_PREFIX = 'skill__';

let dbInstance: Database.Database | null = null;
let discoveredSkills: SkillMeta[] = [];

export function setDatabase(db: Database.Database): void {
  dbInstance = db;
}

export function getDiscoveredSkills(): SkillMeta[] {
  return discoveredSkills;
}

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

  if (!fs.existsSync(dir)) {
    return skills;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const subdir = path.join(dir, entry.name);
    const skillMdPath = path.join(subdir, 'SKILL.md');

    if (fs.existsSync(skillMdPath)) {
      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const parsed = parseSkillFile(content);
        const frontmatter = parsed.frontmatter;
        const lines = parsed.body.split('\n').filter((line) => line.trim());
        const name = frontmatter.name || lines[0]?.replace(/^#\s*/, '') || entry.name;
        const description = frontmatter.description || lines[1]?.replace(/^>\s*/, '') || '';

        skills.push({
          id: entry.name,
          name,
          description,
          dirPath: subdir,
          source,
          triggers: frontmatter.triggers,
          requires: frontmatter.requires,
          priority: frontmatter.priority ?? 100,
        });
      } catch {
        // Skip unreadable skills.
      }
    } else {
      skills.push(...discoverSkillsInDir(subdir, source, maxDepth - 1));
    }
  }

  return skills;
}

export function loadSkillContent(dirPath: string): string {
  const parts: string[] = [];
  const skillMdPath = path.join(dirPath, 'SKILL.md');

  try {
    parts.push(fs.readFileSync(skillMdPath, 'utf-8'));
  } catch {
    return `Skill file not found: ${skillMdPath}`;
  }

  const referencesDir = path.join(dirPath, 'references');
  if (fs.existsSync(referencesDir)) {
    try {
      const referenceEntries = fs.readdirSync(referencesDir, { withFileTypes: true });
      for (const reference of referenceEntries) {
        if (!reference.isFile() || !reference.name.endsWith('.md')) {
          continue;
        }
        try {
          const referenceContent = fs.readFileSync(path.join(referencesDir, reference.name), 'utf-8');
          parts.push(`\n---\n## Reference: ${reference.name}\n\n${referenceContent}`);
        } catch {
          // Skip unreadable reference files.
        }
      }
    } catch {
      // Ignore unreadable references dir.
    }
  }

  const combined = parts.join('\n');
  if (combined.length > MAX_SKILL_CONTENT_SIZE) {
    return `${combined.slice(0, MAX_SKILL_CONTENT_SIZE)}\n\n[Content truncated at 50KB limit]`;
  }
  return combined;
}

export function getExternalSkillDirs(): string[] {
  if (!dbInstance) {
    return [];
  }

  try {
    const row = dbInstance.prepare(
      `SELECT value FROM app_config WHERE key = 'skill_extra_dirs'`
    ).get() as { value: string } | undefined;
    if (!row) {
      return [];
    }
    const dirs = JSON.parse(row.value);
    return Array.isArray(dirs) ? dirs : [];
  } catch {
    return [];
  }
}

export function saveExternalSkillDirs(dirs: string[]): void {
  if (!dbInstance) {
    return;
  }

  dbInstance.prepare(`
    INSERT INTO app_config (key, value) VALUES ('skill_extra_dirs', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(dirs));
}

export async function registerSkillTools(): Promise<number> {
  const allSkills: SkillMeta[] = [];
  const seenIds = new Set<string>();

  const workspaceSkillsDir = path.join(workspaceService.getWorkspaceDir(), 'skills');
  for (const skill of discoverSkillsInDir(workspaceSkillsDir, 'workspace')) {
    if (!seenIds.has(skill.id)) {
      seenIds.add(skill.id);
      allSkills.push(skill);
    }
  }

  for (const dir of getExternalSkillDirs()) {
    for (const skill of discoverSkillsInDir(dir, 'external')) {
      if (!seenIds.has(skill.id)) {
        seenIds.add(skill.id);
        allSkills.push(skill);
      }
    }
  }

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
      handler: async () => loadSkillContent(skill.dirPath),
    });
  }

  discoveredSkills = allSkills;

  if (allSkills.length > 0) {
    console.log(`[SkillTools] Registered ${allSkills.length} skill(s): ${allSkills.map((skill) => skill.id).join(', ')}`);
  }

  return allSkills.length;
}

export async function refreshSkillTools(): Promise<number> {
  toolRegistry.removeBySource('skill');
  return registerSkillTools();
}

export function buildSkillDirectoryHint(): string {
  const skillTools = toolRegistry.getAll().filter((tool) => tool.source === 'skill');
  if (skillTools.length === 0) {
    return '';
  }

  const lines = skillTools.map((tool) => {
    const fn = tool.definition.function;
    return `- ${fn.name}: ${fn.description?.replace(/^\[Skill\]\s*/, '') || ''}`;
  });

  return [
    '## Available Skills',
    '',
    'Call the corresponding tool to load full instructions:',
    ...lines,
  ].join('\n');
}
