import type {
  AgentPermissionRule,
  CategoryAction,
  CategoryProfile,
  PermissionCategory,
  EvaluationContext,
  UnifiedPermissionPolicy,
} from '@my-claudia/shared/interaction/permissions';
import {
  DEFAULT_SENSITIVE_PATTERNS,
} from '@my-claudia/shared/interaction/permissions';
import * as path from 'path';
import { minimatch } from 'minimatch';

import {
  extractPathsFromCommand,
  isPathWithinRoot,
  normalizeExternalRoot,
  extractRememberableShellCommands,
  splitCompoundCommand,
} from './shell-parser.js';

import type { EffectivePolicy } from './policy-utils.js';
import { resolveProfile } from './policy-utils.js';

// ============================================
// Re-exports (preserve public API)
// ============================================

export type { ShellToken } from './shell-parser.js';
export {
  tokenizeShellWords,
  getCommandSignature,
  shouldSkipTokenAsTextArgument,
  shouldIgnoreOutsideWorkspaceExecutable,
  extractPathsFromCommand,
  isPathWithinRoot,
  normalizeExternalRoot,
  splitCompoundCommand,
  extractCommandSubstitutions,
  normalizeRememberableShellFragment,
  unwrapGroupedFragment,
  extractFindExecCommands,
  extractXargsCommands,
  extractShellWrapperCommands,
  extractHeredocCommands,
  extractParallelCommands,
  extractRememberableShellCommands,
} from './shell-parser.js';

export type {
  PermissionMemoryRow,
  PermissionMemoryDb,
  OutsideWorkspaceMemoryRow,
} from './permission-memory.js';
export {
  loadSessionRememberedDecisions,
  persistSessionRememberedDecision,
  loadProjectAllowedOutsideWorkspaceRoots,
  persistProjectAllowedOutsideWorkspaceRoots,
} from './permission-memory.js';

export type { EffectivePolicy } from './policy-utils.js';
export {
  isUnifiedPolicy,
  resolveProfile,
  normalizePolicy,
  mergePolicy,
  getAgentPermissionPolicy,
  getProjectPermissionOverride,
} from './policy-utils.js';

// ============================================
// Types
// ============================================

export type EvaluationResult = 'approve' | 'deny' | 'escalate';
export type RememberedDecision = 'allow' | 'deny';
export type MatchedPermissionRule =
  | 'Always escalate'
  | 'Custom rule'
  | 'Sensitive file access'
  | 'Outside workspace access'
  | 'Category: fileRead'
  | 'Category: fileWrite'
  | 'Category: shellSafe'
  | 'Category: networkOps'
  | 'Category: destructiveOps'
  | 'Category: userQuestions';

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

function hasToolNameSuffix(toolName: string, suffix: string): boolean {
  return toolName === suffix
    || toolName.endsWith(`_${suffix}`)
    || toolName.endsWith(`-${suffix}`)
    || toolName.endsWith(`:${suffix}`);
}

export function isInternalInteractionTool(toolName: string): boolean {
  return hasToolNameSuffix(toolName, 'update_todo_list')
    || hasToolNameSuffix(toolName, 'ask_user_form')
    || hasToolNameSuffix(toolName, 'request_approval')
    || hasToolNameSuffix(toolName, 'push_file')
    || hasToolNameSuffix(toolName, 'enter_plan_mode')
    || hasToolNameSuffix(toolName, 'exit_plan_mode')
    || toolName === 'EnterPlanMode';
}

function isBlockingInteractionTool(toolName: string): boolean {
  return hasToolNameSuffix(toolName, 'ask_user_form')
    || hasToolNameSuffix(toolName, 'request_approval')
    || hasToolNameSuffix(toolName, 'exit_plan_mode')
    || toolName === 'ExitPlanMode';
}

// ============================================
// Outside Workspace Path Analysis
// ============================================

export function getOutsideWorkspacePaths(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string
): string[] {
  if (!rootPath) return [];

  const paths: string[] = [];
  const filePath = extractFilePath(toolInput);
  if (filePath && !isPathWithinRoot(filePath, rootPath)) {
    paths.push(path.resolve(filePath));
  }

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      for (const p of extractPathsFromCommand(command)) {
        if (!isPathWithinRoot(p, rootPath)) {
          paths.push(path.resolve(p));
        }
      }
    }
  }

  return [...new Set(paths)];
}

export function getOutsideWorkspaceRootsToRemember(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string
): string[] {
  return getOutsideWorkspacePaths(toolName, toolInput, detail, rootPath)
    .map((filePath) => normalizeExternalRoot(filePath))
    .filter((dir, index, arr) => arr.indexOf(dir) === index);
}

export function isOutsideWorkspacePathAllowed(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string,
  allowedRoots: Iterable<string>
): boolean {
  const outsidePaths = getOutsideWorkspacePaths(toolName, toolInput, detail, rootPath);
  if (outsidePaths.length === 0) return false;
  const roots = [...allowedRoots].map((root) => path.resolve(root));
  return outsidePaths.every((outsidePath) => (
    roots.some((root) => isPathWithinRoot(outsidePath, root))
  ));
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
  if (isBlockingInteractionTool(toolName)) return 'userQuestions';
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

/** Build stable remember keys for a tool call. */
export function buildRememberKeys(toolName: string, toolInput: unknown, detail: string): string[] {
  if (!isBashLikeTool(toolName)) {
    return [toolName];
  }

  const cmd = extractBashCommand(toolInput, detail);
  if (!cmd) {
    return ['Bash'];
  }

  const normalized = cmd.trim();
  const keys = [`Bash:${normalized}`];
  for (const segment of extractRememberableShellCommands(normalized)) {
    keys.push(`Bash:${segment}`);
  }

  return [...new Set(keys)];
}

/** Backward-compatible single remember key accessor. */
export function buildRememberKey(toolName: string, toolInput: unknown, detail: string): string {
  return buildRememberKeys(toolName, toolInput, detail)[0];
}

export function resolveRememberedDecision(
  lookup: Pick<Map<string, RememberedDecision>, 'get'>,
  toolName: string,
  toolInput: unknown,
  detail: string
): RememberedDecision | null {
  return lookup.get(buildRememberKey(toolName, toolInput, detail)) ?? null;
}

// ============================================
// Matched Permission Rule
// ============================================

export function getMatchedPermissionRule(
  toolName: string,
  toolInput: unknown,
  detail: string,
  policy: EffectivePolicy,
  context?: EvaluationContext
): MatchedPermissionRule | null {
  if (!policy.enabled) return null;

  const rootPath = context?.rootPath || process.cwd();

  if (policy.escalateAlways?.includes(toolName)) {
    return 'Always escalate';
  }

  const customResult = evaluateCustomRules(toolName, detail, policy.customRules || []);
  if (customResult === 'escalate') {
    return 'Custom rule';
  }

  if (policy.globalGuards.blockSensitiveFiles && targetsSensitiveFile(toolName, toolInput, detail)) {
    return 'Sensitive file access';
  }

  if (policy.globalGuards.blockOutsideWorkspace && targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) {
    return 'Outside workspace access';
  }

  const category = classify(toolName, toolInput, detail);
  if (resolveProfile(policy, context)[category] === 'ask') {
    return `Category: ${category}`;
  }

  return null;
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
 * Permission evaluator — unified single-profile evaluation.
 *
 * Evaluation order:
 *   1. escalateAlways list
 *   2. Custom rules (first match wins)
 *   3. Global guards (sensitive files / outside workspace → escalate)
 *   4. Classify tool → category → look up profile → action
 */
export class PermissionEvaluator {
  evaluate(
    toolName: string,
    toolInput: unknown,
    detail: string,
    policy: EffectivePolicy,
    context?: EvaluationContext
  ): EvaluationResult {
    if (!policy.enabled) return 'escalate';

    const rootPath = context?.rootPath || process.cwd();

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
    const action = resolveProfile(policy, context)[category];

    return actionToResult(action);
  }
}
