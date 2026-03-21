import type {
  AgentPermissionPolicy,
  AgentPermissionRule,
  CategoryPermissionPolicy,
  CategoryAction,
  CategoryProfile,
  PermissionCategory,
  EvaluationContext,
} from '@my-claudia/shared';
import {
  DEFAULT_SENSITIVE_PATTERNS,
  DEFAULT_CATEGORY_POLICY,
  DEFAULT_CATEGORY_PROFILES,
  DEFAULT_GLOBAL_GUARDS,
} from '@my-claudia/shared';
import * as path from 'path';
import { minimatch } from 'minimatch';

// ============================================
// Types
// ============================================

export type EvaluationResult = 'approve' | 'deny' | 'escalate';

// ============================================
// Shared Utilities
// ============================================

/** Extract file_path from toolInput (used by Write, Edit, Read, etc.) */
function extractFilePath(toolInput: unknown): string | null {
  if (toolInput && typeof toolInput === 'object' && 'file_path' in toolInput) {
    const fp = (toolInput as { file_path: unknown }).file_path;
    if (typeof fp === 'string') return fp;
  }
  return null;
}

/** Extract Bash command from toolInput or detail */
export function extractBashCommand(toolInput: unknown, detail: string): string | null {
  const normalizeCommandText = (value: string): string => {
    return value
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  };

  if (toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
    const cmd = (toolInput as { command: unknown }).command;
    if (typeof cmd === 'string') return normalizeCommandText(cmd);
  }
  if (detail) return normalizeCommandText(detail);
  return null;
}

export function isBashLikeTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'bash'
    || lower === 'execute_command'
    || lower === 'run_terminal_cmd'
    || lower === 'terminal'
    || lower === 'agent_shell';
}

function extractPathsFromCommand(command: string): string[] {
  const paths: string[] = [];
  const matches = command.match(/(?:^|\s)(\/[^\s;|&>]+)/g);
  if (matches) {
    for (const m of matches) {
      paths.push(m.trim());
    }
  }
  return paths;
}

function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootPath);
  return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot;
}

// ============================================
// Tool Categories
// ============================================

const READONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];

const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/i,
  /\bformat\b/i,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bgit\s+push\s+(-f|--force)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bchmod\s+777\b/,
  /\bchown\b.*-R\b/,
  />\s*\/dev\/sd[a-z]/,
  /\bcurl\b.*\|\s*(ba)?sh\b/,
  /\bwget\b.*\|\s*(ba)?sh\b/,
];

const NETWORK_BASH_PATTERNS = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\brsync\b.*:/,
  /\bnpm\s+publish\b/,
  /\byarn\s+publish\b/,
  /\bgit\s+push\b/,
  /\bgit\s+fetch\b/,
  /\bgit\s+pull\b/,
  /\bgit\s+clone\b/,
  /\bdocker\s+push\b/,
  /\bdocker\s+pull\b/,
  /\bnc\b/,
  /\btelnet\b/,
];

// ============================================
// Internal Guard Checks
// ============================================

function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return DEFAULT_SENSITIVE_PATTERNS.some(p => minimatch(basename, p, { dot: true }));
}

function targetsSensitiveFile(toolName: string, toolInput: unknown, detail: string): boolean {
  const filePath = extractFilePath(toolInput);
  if (filePath && isSensitiveFile(filePath)) return true;

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      return extractPathsFromCommand(command).some(p => isSensitiveFile(p));
    }
  }
  return false;
}

function targetsOutsideWorkspace(toolName: string, toolInput: unknown, detail: string, rootPath: string): boolean {
  if (!rootPath) return false;

  const filePath = extractFilePath(toolInput);
  if (filePath && !isPathWithinRoot(filePath, rootPath)) return true;

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      return extractPathsFromCommand(command).some(p => !isPathWithinRoot(p, rootPath));
    }
  }
  return false;
}

function isNetworkCommand(toolInput: unknown, detail: string): boolean {
  const command = extractBashCommand(toolInput, detail);
  if (!command) return false;
  return NETWORK_BASH_PATTERNS.some(p => p.test(command));
}

function isDangerousCommand(toolInput: unknown, detail: string): boolean {
  const command = extractBashCommand(toolInput, detail);
  if (!command) return true; // No command = can't verify safety = escalate
  return DANGEROUS_BASH_PATTERNS.some(p => p.test(command));
}

// ============================================
// Tool Classification
// ============================================

/** Classify a tool call into a permission category */
export function classify(toolName: string, toolInput: unknown, detail: string): PermissionCategory {
  if (toolName === 'AskUserQuestion') return 'userQuestions';
  if (READONLY_TOOLS.includes(toolName)) return 'fileRead';
  if (EDIT_TOOLS.includes(toolName)) return 'fileWrite';

  if (isBashLikeTool(toolName)) {
    if (isDangerousCommand(toolInput, detail)) return 'destructiveOps';
    if (isNetworkCommand(toolInput, detail)) return 'networkOps';
    return 'shellSafe';
  }

  // Task tool and other unknown tools → shellSafe (custom rules can override)
  return 'shellSafe';
}

/** Map a CategoryAction to an EvaluationResult */
function actionToResult(action: CategoryAction): EvaluationResult {
  switch (action) {
    case 'auto-approve': return 'approve';
    case 'ask': return 'escalate';
    case 'block': return 'deny';
  }
}

// ============================================
// Remember Key Builder
// ============================================

/** Build a key for the per-session remember cache */
export function buildRememberKey(toolName: string, toolInput: unknown, detail: string): string {
  if (isBashLikeTool(toolName)) {
    const cmd = extractBashCommand(toolInput, detail);
    if (cmd) {
      // Normalize: keep first two tokens (e.g. "git push", "npm install", "curl")
      const parts = cmd.split(/\s+/);
      const base = parts.slice(0, Math.min(2, parts.length)).join(' ');
      return `Bash:${base}`;
    }
  }
  return toolName;
}

// ============================================
// Custom Rules Evaluator
// ============================================

type CustomRuleResult = 'approve' | 'deny' | 'escalate' | 'continue';

function evaluateCustomRules(toolName: string, detail: string, rules: AgentPermissionRule[]): CustomRuleResult {
  for (const rule of rules) {
    if (rule.toolName === '*' || rule.toolName === toolName) {
      if (rule.pattern) {
        try {
          const re = new RegExp(rule.pattern, 'i');
          if (re.test(detail)) return rule.action;
        } catch {
          continue;
        }
      } else {
        return rule.action;
      }
    }
  }
  return 'continue';
}

// ============================================
// Category-Based Permission Evaluator
// ============================================

/**
 * Permission evaluator with category-based profiles per session type.
 *
 * Evaluation order:
 *   1. escalateAlways list
 *   2. Custom rules (first match wins)
 *   3. Global guards (sensitive files / outside workspace → escalate)
 *   4. Classify tool → category → look up profile for session type → action
 */
export class PermissionEvaluator {
  evaluate(
    toolName: string,
    toolInput: unknown,
    detail: string,
    policy: CategoryPermissionPolicy,
    context?: EvaluationContext
  ): EvaluationResult {
    if (!policy.enabled) return 'escalate';

    const rootPath = context?.rootPath || process.cwd();
    const sessionType = context?.sessionType || 'regular';

    // 1. escalateAlways
    if (policy.escalateAlways?.includes(toolName)) {
      return 'escalate';
    }

    // 2. Custom rules (first match wins)
    const customResult = evaluateCustomRules(toolName, detail, policy.customRules || []);
    if (customResult !== 'continue') {
      return customResult;
    }

    // 3. Global guards → escalate (user can override)
    if (policy.globalGuards.blockSensitiveFiles && targetsSensitiveFile(toolName, toolInput, detail)) {
      return 'escalate';
    }
    if (policy.globalGuards.blockOutsideWorkspace && targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) {
      return 'escalate';
    }

    // 4. Category-based evaluation
    const category = classify(toolName, toolInput, detail);
    const profile = policy.profiles[sessionType] || policy.profiles.regular;
    const action = profile[category];

    return actionToResult(action);
  }
}

// ============================================
// Policy Utilities
// ============================================

/**
 * Detect whether a raw policy object is the old trustLevel format or new category format.
 */
function isLegacyPolicy(raw: unknown): raw is AgentPermissionPolicy {
  return raw !== null && typeof raw === 'object' && 'trustLevel' in (raw as Record<string, unknown>);
}

/**
 * Convert a legacy trustLevel to category profiles.
 */
function trustLevelToProfiles(trustLevel: string): CategoryPermissionPolicy['profiles'] {
  switch (trustLevel) {
    case 'conservative':
      return {
        regular:    { fileRead: 'auto-approve', fileWrite: 'ask', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
        background: { fileRead: 'auto-approve', fileWrite: 'ask', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
        agent:      { fileRead: 'ask', fileWrite: 'ask', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
      };
    case 'moderate':
      return {
        regular:    { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
        background: { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
        agent:      { fileRead: 'auto-approve', fileWrite: 'ask', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
      };
    case 'aggressive':
      return {
        regular:    { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
        background: { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'block', destructiveOps: 'block', userQuestions: 'ask' },
        agent:      { fileRead: 'auto-approve', fileWrite: 'ask', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' },
      };
    case 'full_trust':
      return {
        regular:    { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'auto-approve', destructiveOps: 'block', userQuestions: 'ask' },
        background: { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'block', destructiveOps: 'block', userQuestions: 'ask' },
        agent:      DEFAULT_CATEGORY_PROFILES.agent,
      };
    default:
      return DEFAULT_CATEGORY_PROFILES;
  }
}

/**
 * Normalize a policy from the database — handles both old trustLevel and new category format.
 */
export function normalizePolicy(raw: unknown): CategoryPermissionPolicy {
  if (!raw || typeof raw !== 'object') return DEFAULT_CATEGORY_POLICY;

  // New format: has `profiles` key
  if ('profiles' in (raw as Record<string, unknown>)) {
    const policy = raw as CategoryPermissionPolicy;
    const escalateAlways = [...(policy.escalateAlways || ['AskUserQuestion'])];
    if (!escalateAlways.includes('ExitPlanMode')) escalateAlways.push('ExitPlanMode');
    return {
      enabled: policy.enabled ?? true,
      profiles: {
        regular: { ...DEFAULT_CATEGORY_PROFILES.regular, ...policy.profiles?.regular },
        background: { ...DEFAULT_CATEGORY_PROFILES.background, ...policy.profiles?.background },
        agent: { ...DEFAULT_CATEGORY_PROFILES.agent, ...policy.profiles?.agent },
      },
      globalGuards: { ...DEFAULT_GLOBAL_GUARDS, ...policy.globalGuards },
      customRules: policy.customRules || [],
      escalateAlways,
    };
  }

  // Old format: trustLevel-based
  if (isLegacyPolicy(raw)) {
    const escalateAlways = [...(raw.escalateAlways || ['AskUserQuestion'])];
    if (!escalateAlways.includes('ExitPlanMode')) escalateAlways.push('ExitPlanMode');
    return {
      enabled: raw.enabled ?? false,
      profiles: trustLevelToProfiles(raw.trustLevel),
      globalGuards: DEFAULT_GLOBAL_GUARDS,
      customRules: raw.customRules || [],
      escalateAlways,
    };
  }

  return DEFAULT_CATEGORY_POLICY;
}

/**
 * Merge a project-level override into the global policy.
 * Project overrides can only affect regular and background profiles (agent is global-only).
 */
export function mergePolicy(
  globalPolicy: CategoryPermissionPolicy,
  projectOverride?: Partial<CategoryPermissionPolicy> | null
): CategoryPermissionPolicy {
  if (!projectOverride) return globalPolicy;

  const merged: CategoryPermissionPolicy = {
    ...globalPolicy,
    profiles: {
      regular: { ...globalPolicy.profiles.regular, ...projectOverride.profiles?.regular },
      background: { ...globalPolicy.profiles.background, ...projectOverride.profiles?.background },
      agent: globalPolicy.profiles.agent, // Agent profile is NOT overridden by project
    },
    globalGuards: { ...globalPolicy.globalGuards, ...projectOverride.globalGuards },
  };

  if (projectOverride.enabled !== undefined) merged.enabled = projectOverride.enabled;
  if (projectOverride.customRules !== undefined) merged.customRules = projectOverride.customRules;
  if (projectOverride.escalateAlways !== undefined) merged.escalateAlways = projectOverride.escalateAlways;

  return merged;
}

/**
 * Read agent permission policy from database (handles both old and new format).
 */
export function getAgentPermissionPolicy(
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } }
): CategoryPermissionPolicy | null {
  try {
    const row = db.prepare(
      'SELECT permission_policy FROM agent_config WHERE id = 1'
    ).get() as { permission_policy: string | null } | undefined;

    if (!row?.permission_policy) return null;

    const raw = JSON.parse(row.permission_policy);
    return normalizePolicy(raw);
  } catch {
    return null;
  }
}

/**
 * Read project-level agent permission override from database.
 */
export function getProjectPermissionOverride(
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } },
  projectId: string
): Partial<CategoryPermissionPolicy> | null {
  try {
    const row = db.prepare(
      'SELECT agent_permission_override FROM projects WHERE id = ?'
    ).get(projectId) as { agent_permission_override: string | null } | undefined;

    if (!row?.agent_permission_override) return null;

    const raw = JSON.parse(row.agent_permission_override);
    // If legacy format, convert first then extract as partial
    if (isLegacyPolicy(raw)) {
      const converted = normalizePolicy(raw);
      return { profiles: { regular: converted.profiles.regular, background: converted.profiles.background } } as Partial<CategoryPermissionPolicy>;
    }
    return raw as Partial<CategoryPermissionPolicy>;
  } catch {
    return null;
  }
}
