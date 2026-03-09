import * as fs from 'fs';
import * as path from 'path';

export interface PlanValidationResult {
  exists: boolean;
  ready: boolean;
  score: number;
  missing: string[];
  path: string;
}

const REQUIRED_SECTIONS = ['goal', 'scope', 'steps', 'verification'];
const OPTIONAL_SECTIONS = ['risks', 'assumptions'];

function normalizeHeading(raw: string): string {
  // Handle both trailing colons and colons in the middle (e.g., "Goal：目标")
  // Extract just the heading name before any colon
  return raw.trim().toLowerCase().split(/[：:]/)[0].trim();
}

function extractSections(markdown: string): Record<string, string> {
  const lines = markdown.split(/\r?\n/);
  const sections: Record<string, string[]> = {};
  let current: string | null = null;

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      current = normalizeHeading(heading[1]);
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) {
    out[k] = v.join('\n').trim();
  }
  return out;
}

export function validatePlanMarkdownContent(content: string, filePath: string): PlanValidationResult {
  const sections = extractSections(content);
  const missing: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    if (!sections[section]) missing.push(section);
  }

  // Soft checks (do not block readiness when required sections are present)
  let score = 0;
  const requiredHit = REQUIRED_SECTIONS.filter((s) => !!sections[s]).length;
  const optionalHit = OPTIONAL_SECTIONS.filter((s) => !!sections[s]).length;
  score += Math.round((requiredHit / REQUIRED_SECTIONS.length) * 80);
  score += Math.round((optionalHit / OPTIONAL_SECTIONS.length) * 15);
  if (content.trim().length >= 250) score += 5;
  score = Math.min(100, score);

  return {
    exists: true,
    ready: missing.length === 0,
    score,
    missing,
    path: filePath,
  };
}

export function validatePlanFile(projectRoot: string, taskId: string): PlanValidationResult {
  const planPath = path.join(projectRoot, '.supervision', 'plans', `task-${taskId}.plan.md`);
  if (!fs.existsSync(planPath)) {
    return {
      exists: false,
      ready: false,
      score: 0,
      missing: ['plan_file'],
      path: planPath,
    };
  }
  const content = fs.readFileSync(planPath, 'utf-8');
  return validatePlanMarkdownContent(content, planPath);
}
