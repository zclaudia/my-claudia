import type { AgentPermissionPolicy, EvaluationContext } from '@my-claudia/shared';
import { DEFAULT_SENSITIVE_PATTERNS } from '@my-claudia/shared';
import * as path from 'path';
import { minimatch } from 'minimatch';

// ============================================
// Strategy Result Types
// ============================================

export type StrategyResult = 'approve' | 'deny' | 'escalate' | 'continue';
export type EvaluationResult = 'approve' | 'deny' | 'escalate';

interface StrategyInput {
  toolName: string;
  toolInput: unknown;
  detail: string;
  policy: AgentPermissionPolicy;
  context: EvaluationContext;
}

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
  // Match absolute paths (starting with /)
  const matches = command.match(/(?:^|\s)(\/[^\s;|&>]+)/g);
  if (matches) {
    for (const m of matches) {
      paths.push(m.trim());
    }
  }
  return paths;
}

/** Check if a path is within an allowed directory */
function isPathAllowed(filePath: string, rootPath: string, allowedPaths: string[]): boolean {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootPath);

  // Within workspace root
  if (resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot) {
    return true;
  }

  // Within any allowed extra path
  for (const allowed of allowedPaths) {
    const resolvedAllowed = path.resolve(allowed);
    if (resolved.startsWith(resolvedAllowed + path.sep) || resolved === resolvedAllowed) {
      return true;
    }
  }

  return false;
}

// ============================================
// Strategy Implementations
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
  /\brsync\b.*:/,                 // rsync with remote
  /\bnpm\s+publish\b/,
  /\byarn\s+publish\b/,
  /\bgit\s+push\b/,
  /\bgit\s+fetch\b/,
  /\bgit\s+pull\b/,
  /\bgit\s+clone\b/,
  /\bdocker\s+push\b/,
  /\bdocker\s+pull\b/,
  /\bnc\b/,                       // netcat
  /\btelnet\b/,
];

/**
 * Strategy 1: Custom Rules (user-defined, first match wins)
 */
function evaluateCustomRules(input: StrategyInput): StrategyResult {
  for (const rule of input.policy.customRules || []) {
    if (rule.toolName === '*' || rule.toolName === input.toolName) {
      if (rule.pattern) {
        try {
          const re = new RegExp(rule.pattern, 'i');
          if (re.test(input.detail)) {
            return rule.action;
          }
        } catch {
          continue; // Invalid regex — skip
        }
      } else {
        return rule.action;
      }
    }
  }
  return 'continue';
}

/**
 * Strategy 2: Sensitive Files — escalate operations on sensitive files
 */
function evaluateSensitiveFiles(input: StrategyInput): StrategyResult {
  const config = input.policy.strategies?.sensitiveFiles;
  if (!config?.enabled) return 'continue';

  const patterns = config.patterns.length > 0 ? config.patterns : DEFAULT_SENSITIVE_PATTERNS;

  // Check file_path from tool input
  const filePath = extractFilePath(input.toolInput);
  if (filePath) {
    const basename = path.basename(filePath);
    for (const pattern of patterns) {
      if (minimatch(basename, pattern, { dot: true })) {
        return 'escalate';
      }
    }
  }

  // For Bash commands, check paths in the command
  if (input.toolName === 'Bash') {
    const command = extractBashCommand(input.toolInput, input.detail);
    if (command) {
      const cmdPaths = extractPathsFromCommand(command);
      for (const p of cmdPaths) {
        const basename = path.basename(p);
        for (const pattern of patterns) {
          if (minimatch(basename, pattern, { dot: true })) {
            return 'escalate';
          }
        }
      }
    }
  }

  return 'continue';
}

/**
 * Strategy 3: Workspace Scope — escalate operations outside allowed paths
 */
function evaluateWorkspaceScope(input: StrategyInput): StrategyResult {
  const config = input.policy.strategies?.workspaceScope;
  if (!config?.enabled) return 'continue';

  const rootPath = input.context.rootPath;
  if (!rootPath) return 'continue'; // Can't check without a root path

  const allowedPaths = config.allowedPaths || [];

  // Check file_path from tool input
  const filePath = extractFilePath(input.toolInput);
  if (filePath) {
    if (!isPathAllowed(filePath, rootPath, allowedPaths)) {
      return 'escalate';
    }
  }

  // For Bash commands, check paths in the command
  if (input.toolName === 'Bash') {
    const command = extractBashCommand(input.toolInput, input.detail);
    if (command) {
      const cmdPaths = extractPathsFromCommand(command);
      for (const p of cmdPaths) {
        if (!isPathAllowed(p, rootPath, allowedPaths)) {
          return 'escalate';
        }
      }
    }
  }

  return 'continue';
}

/**
 * Strategy 4: Network Access — escalate Bash commands with network operations
 */
function evaluateNetworkAccess(input: StrategyInput): StrategyResult {
  const config = input.policy.strategies?.networkAccess;
  if (!config?.enabled) return 'continue';

  if (input.toolName !== 'Bash') return 'continue';

  const command = extractBashCommand(input.toolInput, input.detail);
  if (!command) return 'continue';

  for (const pattern of NETWORK_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return 'escalate';
    }
  }

  return 'continue';
}

/**
 * Strategy 5: Trust Level — the existing trust-based evaluation
 */
function evaluateTrustLevel(input: StrategyInput): StrategyResult {
  const { toolName, toolInput, detail, policy } = input;

  // AskUserQuestion always escalates
  if (toolName === 'AskUserQuestion') return 'escalate';

  switch (policy.trustLevel) {
    case 'conservative':
      if (READONLY_TOOLS.includes(toolName)) return 'approve';
      return 'escalate';

    case 'moderate':
      if (READONLY_TOOLS.includes(toolName)) return 'approve';
      if (EDIT_TOOLS.includes(toolName)) return 'approve';
      if (toolName === 'Task') return 'approve';
      return 'escalate';

    case 'aggressive': {
      if (READONLY_TOOLS.includes(toolName)) return 'approve';
      if (EDIT_TOOLS.includes(toolName)) return 'approve';
      if (toolName === 'Task') return 'approve';

      if (toolName === 'Bash') {
        const command = extractBashCommand(toolInput, detail);
        if (!command) return 'escalate';

        for (const pattern of DANGEROUS_BASH_PATTERNS) {
          if (pattern.test(command)) {
            return 'escalate';
          }
        }
        return 'approve';
      }

      return 'escalate';
    }

    default:
      return 'escalate';
  }
}

// ============================================
// Strategy Chain Evaluator
// ============================================

/**
 * Strategy chain permission evaluator.
 *
 * Evaluation order:
 *   1. escalateAlways list
 *   2. customRules (user-defined)
 *   3. sensitiveFiles
 *   4. workspaceScope
 *   5. networkAccess
 *   6. trustLevel (existing logic)
 *   7. aiAnalysis (async, future — placeholder)
 *
 * Each strategy returns 'approve' | 'deny' | 'escalate' | 'continue'.
 * 'continue' means the strategy has no opinion; pass to the next.
 */
export class PermissionEvaluator {
  /**
   * Evaluate a permission request against the policy using the strategy chain.
   * Returns 'approve', 'deny', or 'escalate'.
   */
  evaluate(
    toolName: string,
    toolInput: unknown,
    detail: string,
    policy: AgentPermissionPolicy,
    context?: EvaluationContext
  ): EvaluationResult {
    if (!policy.enabled) return 'escalate';

    const effectiveContext: EvaluationContext = context || {
      rootPath: process.cwd(),
      sessionType: 'regular',
    };

    const input: StrategyInput = { toolName, toolInput, detail, policy, context: effectiveContext };

    // 1. Check escalateAlways list
    if (policy.escalateAlways?.includes(toolName)) {
      return 'escalate';
    }

    // 2-6. Run strategy chain
    const strategies: Array<(input: StrategyInput) => StrategyResult> = [
      evaluateCustomRules,      // 2. User-defined rules
      evaluateSensitiveFiles,   // 3. Sensitive file protection
      evaluateWorkspaceScope,   // 4. Workspace path boundaries
      evaluateNetworkAccess,    // 5. Network access detection
      evaluateTrustLevel,       // 6. Trust level defaults
    ];

    for (const strategy of strategies) {
      const result = strategy(input);
      if (result !== 'continue') {
        return result;
      }
    }

    // 7. AI Analysis (placeholder — async, handled separately)
    // If aiAnalysis is enabled and we reach here, the caller should
    // invoke evaluateWithAI() separately as it's async.
    if (policy.strategies?.aiAnalysis?.enabled) {
      // Signal that AI analysis should be attempted
      return 'escalate'; // Fallback: escalate synchronously
    }

    // All strategies returned 'continue' — default to escalate
    return 'escalate';
  }
}

// ============================================
// Policy Utilities
// ============================================

/**
 * Merge a project-level override into the global policy.
 * Project fields that are defined override the corresponding global fields.
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

  // Deep merge strategies
  if (projectOverride.strategies) {
    merged.strategies = { ...globalPolicy.strategies };
    const override = projectOverride.strategies;

    if (override.workspaceScope !== undefined) {
      merged.strategies!.workspaceScope = override.workspaceScope;
    }
    if (override.sensitiveFiles !== undefined) {
      merged.strategies!.sensitiveFiles = override.sensitiveFiles;
    }
    if (override.networkAccess !== undefined) {
      merged.strategies!.networkAccess = override.networkAccess;
    }
    if (override.aiAnalysis !== undefined) {
      merged.strategies!.aiAnalysis = override.aiAnalysis;
    }
  }

  return merged;
}

/**
 * Normalize a policy that may be missing the strategies field (backward compat).
 * Old policies without strategies get all strategies disabled by default.
 */
export function normalizePolicy(policy: AgentPermissionPolicy): AgentPermissionPolicy {
  if (!policy.strategies) {
    return {
      ...policy,
      strategies: {
        workspaceScope: { enabled: false, allowedPaths: [] },
        sensitiveFiles: { enabled: false, patterns: [...DEFAULT_SENSITIVE_PATTERNS] },
        networkAccess: { enabled: false },
        aiAnalysis: { enabled: false },
      },
    };
  }
  return policy;
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
