import type { AgentPermissionPolicy, EvaluationContext } from '@my-claudia/shared';
import { DEFAULT_SENSITIVE_PATTERNS } from '@my-claudia/shared';
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
function extractBashCommand(toolInput: unknown, detail: string): string | null {
  if (toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
    const cmd = (toolInput as { command: unknown }).command;
    if (typeof cmd === 'string') return cmd;
  }
  if (detail) return detail;
  return null;
}

/**
 * Extract all file paths referenced in a Bash command.
 * Simple heuristic: looks for absolute paths (/...) in the command string.
 */
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

/** Check if a path is within an allowed directory */
function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootPath);
  return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot;
}

// ============================================
// Tool Categories
// ============================================

// Read-only tools that are generally safe
const READONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];

// Edit tools that modify files but are non-destructive
const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

// Dangerous bash patterns that should always be escalated
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
  />\s*\/dev\/sd[a-z]/,           // write to raw device
  /\bcurl\b.*\|\s*(ba)?sh\b/,    // curl | bash
  /\bwget\b.*\|\s*(ba)?sh\b/,    // wget | bash
];

// Network-related bash patterns
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

/** Check if a file path targets a sensitive file */
function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return DEFAULT_SENSITIVE_PATTERNS.some(p => minimatch(basename, p, { dot: true }));
}

/** Check if a tool operation targets a sensitive file */
function targetsSensitiveFile(toolName: string, toolInput: unknown, detail: string): boolean {
  // Check file_path from tool input
  const filePath = extractFilePath(toolInput);
  if (filePath && isSensitiveFile(filePath)) return true;

  // For Bash commands, check paths in the command
  if (toolName === 'Bash') {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      return extractPathsFromCommand(command).some(p => isSensitiveFile(p));
    }
  }
  return false;
}

/** Check if a tool operation targets a path outside workspace */
function targetsOutsideWorkspace(toolName: string, toolInput: unknown, detail: string, rootPath: string): boolean {
  if (!rootPath) return false;

  const filePath = extractFilePath(toolInput);
  if (filePath && !isPathWithinRoot(filePath, rootPath)) return true;

  if (toolName === 'Bash') {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      return extractPathsFromCommand(command).some(p => !isPathWithinRoot(p, rootPath));
    }
  }
  return false;
}

/** Check if a Bash command involves network access */
function isNetworkCommand(toolInput: unknown, detail: string): boolean {
  const command = extractBashCommand(toolInput, detail);
  if (!command) return false;
  return NETWORK_BASH_PATTERNS.some(p => p.test(command));
}

/** Check if a Bash command matches dangerous patterns */
function isDangerousCommand(toolInput: unknown, detail: string): boolean {
  const command = extractBashCommand(toolInput, detail);
  if (!command) return true; // No command = can't verify safety = escalate
  return DANGEROUS_BASH_PATTERNS.some(p => p.test(command));
}

// ============================================
// Custom Rules Evaluator
// ============================================

type CustomRuleResult = 'approve' | 'deny' | 'escalate' | 'continue';

function evaluateCustomRules(toolName: string, detail: string, policy: AgentPermissionPolicy): CustomRuleResult {
  for (const rule of policy.customRules || []) {
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
// Trust Level Evaluator (with built-in guards)
// ============================================

/**
 * Permission evaluator with trust levels that have built-in strategy guards.
 *
 * Trust levels:
 *   conservative — Read-only tools + sensitive file protection
 *   moderate     — + file edits + workspace scope protection
 *   aggressive   — + safe bash + network command protection
 *   full_trust   — Everything except dangerous bash (rm -rf, sudo, etc.)
 *
 * Evaluation order:
 *   1. escalateAlways list (always escalate certain tools)
 *   2. Custom rules (user-defined, first match wins)
 *   3. Trust level evaluation (with built-in guards)
 */
export class PermissionEvaluator {
  evaluate(
    toolName: string,
    toolInput: unknown,
    detail: string,
    policy: AgentPermissionPolicy,
    context?: EvaluationContext
  ): EvaluationResult {
    if (!policy.enabled) return 'escalate';

    const rootPath = context?.rootPath || process.cwd();

    // 1. escalateAlways
    if (policy.escalateAlways?.includes(toolName)) {
      return 'escalate';
    }

    // 2. Custom rules (first match wins)
    const customResult = evaluateCustomRules(toolName, detail, policy);
    if (customResult !== 'continue') {
      console.log(`[Permission] Custom rule returned '${customResult}' for ${toolName}`);
      return customResult;
    }

    // 3. Trust level with built-in guards
    const result = this.evaluateTrustLevel(toolName, toolInput, detail, policy.trustLevel, rootPath);
    console.log(`[Permission] Trust level '${policy.trustLevel}' returned '${result}' for ${toolName}`);
    return result;
  }

  private evaluateTrustLevel(
    toolName: string,
    toolInput: unknown,
    detail: string,
    trustLevel: AgentPermissionPolicy['trustLevel'],
    rootPath: string
  ): EvaluationResult {
    // AskUserQuestion always escalates regardless of trust level
    if (toolName === 'AskUserQuestion') return 'escalate';

    switch (trustLevel) {
      // ── Conservative: read-only + sensitive file guard ──
      case 'conservative': {
        if (!READONLY_TOOLS.includes(toolName)) return 'escalate';
        // Guard: protect sensitive files even for reads
        if (targetsSensitiveFile(toolName, toolInput, detail)) return 'escalate';
        return 'approve';
      }

      // ── Moderate: + file edits + workspace scope guard ──
      case 'moderate': {
        if (toolName === 'Task') return 'approve';
        if (!READONLY_TOOLS.includes(toolName) && !EDIT_TOOLS.includes(toolName)) return 'escalate';
        // Guards: sensitive files + workspace scope
        if (targetsSensitiveFile(toolName, toolInput, detail)) return 'escalate';
        if (targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) return 'escalate';
        return 'approve';
      }

      // ── Aggressive: + safe bash + network command guard ──
      case 'aggressive': {
        if (toolName === 'Task') return 'approve';
        if (READONLY_TOOLS.includes(toolName) || EDIT_TOOLS.includes(toolName)) {
          // Guards: sensitive files + workspace scope
          if (targetsSensitiveFile(toolName, toolInput, detail)) return 'escalate';
          if (targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) return 'escalate';
          return 'approve';
        }
        if (toolName === 'Bash') {
          if (isDangerousCommand(toolInput, detail)) return 'escalate';
          if (isNetworkCommand(toolInput, detail)) return 'escalate';
          // Guards for bash: sensitive files + workspace scope
          if (targetsSensitiveFile(toolName, toolInput, detail)) return 'escalate';
          if (targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) return 'escalate';
          return 'approve';
        }
        return 'escalate';
      }

      // ── Full Trust: everything except dangerous bash ──
      case 'full_trust': {
        if (toolName === 'Task') return 'approve';
        if (READONLY_TOOLS.includes(toolName) || EDIT_TOOLS.includes(toolName)) return 'approve';
        if (toolName === 'Bash') {
          if (isDangerousCommand(toolInput, detail)) return 'escalate';
          return 'approve';
        }
        return 'approve';
      }

      default:
        return 'escalate';
    }
  }
}

// ============================================
// Policy Utilities
// ============================================

/**
 * Merge a project-level override into the global policy.
 */
export function mergePolicy(
  globalPolicy: AgentPermissionPolicy,
  projectOverride?: Partial<AgentPermissionPolicy> | null
): AgentPermissionPolicy {
  if (!projectOverride) return globalPolicy;

  const merged: AgentPermissionPolicy = { ...globalPolicy };

  if (projectOverride.enabled !== undefined) merged.enabled = projectOverride.enabled;
  if (projectOverride.trustLevel !== undefined) merged.trustLevel = projectOverride.trustLevel;
  if (projectOverride.customRules !== undefined) merged.customRules = projectOverride.customRules;
  if (projectOverride.escalateAlways !== undefined) merged.escalateAlways = projectOverride.escalateAlways;

  return merged;
}

/**
 * Normalize a policy from the database (backward compat).
 * Strips deprecated strategies field.
 */
export function normalizePolicy(policy: AgentPermissionPolicy): AgentPermissionPolicy {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { strategies: _deprecated, ...clean } = policy;
  return {
    ...clean,
    customRules: clean.customRules || [],
    escalateAlways: clean.escalateAlways || ['AskUserQuestion'],
  };
}

/**
 * Read agent permission policy from database.
 */
export function getAgentPermissionPolicy(
  db: { prepare: (sql: string) => { get: (...args: any[]) => any } }
): AgentPermissionPolicy | null {
  try {
    const row = db.prepare(
      'SELECT permission_policy FROM agent_config WHERE id = 1'
    ).get() as { permission_policy: string | null } | undefined;

    if (!row?.permission_policy) return null;

    const policy = JSON.parse(row.permission_policy) as AgentPermissionPolicy;
    return normalizePolicy(policy);
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
): Partial<AgentPermissionPolicy> | null {
  try {
    const row = db.prepare(
      'SELECT agent_permission_override FROM projects WHERE id = ?'
    ).get(projectId) as { agent_permission_override: string | null } | undefined;

    if (!row?.agent_permission_override) return null;

    return JSON.parse(row.agent_permission_override) as Partial<AgentPermissionPolicy>;
  } catch {
    return null;
  }
}
