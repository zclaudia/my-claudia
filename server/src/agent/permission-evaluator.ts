import type { AgentPermissionPolicy } from '@my-claudia/shared';

export type EvaluationResult = 'approve' | 'deny' | 'escalate';

// Dangerous bash patterns that should always be escalated or denied
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

// Read-only tools that are generally safe
const READONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];

// Edit tools that modify files but are non-destructive
const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

/**
 * Pure policy-based permission evaluator.
 * No AI calls — guaranteed fast (microsecond) responses.
 */
export class PermissionEvaluator {
  /**
   * Evaluate a permission request against the policy.
   * Returns 'approve', 'deny', or 'escalate' (fall through to user UI).
   */
  evaluate(
    toolName: string,
    toolInput: unknown,
    detail: string,
    policy: AgentPermissionPolicy
  ): EvaluationResult {
    if (!policy.enabled) return 'escalate';

    // 1. Check escalateAlways list
    if (policy.escalateAlways?.includes(toolName)) {
      return 'escalate';
    }

    // 2. Check custom rules (first match wins)
    for (const rule of policy.customRules || []) {
      if (rule.toolName === '*' || rule.toolName === toolName) {
        // If rule has a pattern, check against detail
        if (rule.pattern) {
          try {
            const re = new RegExp(rule.pattern, 'i');
            if (re.test(detail)) {
              return rule.action;
            }
          } catch {
            // Invalid regex — skip this rule
            continue;
          }
        } else {
          return rule.action;
        }
      }
    }

    // 3. Apply trust level defaults
    return this.evaluateByTrustLevel(toolName, toolInput, detail, policy.trustLevel);
  }

  private evaluateByTrustLevel(
    toolName: string,
    toolInput: unknown,
    detail: string,
    trustLevel: AgentPermissionPolicy['trustLevel']
  ): EvaluationResult {
    // AskUserQuestion always escalates — it's designed for user interaction
    if (toolName === 'AskUserQuestion') {
      return 'escalate';
    }

    switch (trustLevel) {
      case 'conservative':
        return this.evaluateConservative(toolName);

      case 'moderate':
        return this.evaluateModerate(toolName);

      case 'aggressive':
        return this.evaluateAggressive(toolName, toolInput, detail);

      default:
        return 'escalate';
    }
  }

  /**
   * Conservative: only approve read-only tools
   */
  private evaluateConservative(toolName: string): EvaluationResult {
    if (READONLY_TOOLS.includes(toolName)) return 'approve';
    return 'escalate';
  }

  /**
   * Moderate: approve read-only + file edits
   */
  private evaluateModerate(toolName: string): EvaluationResult {
    if (READONLY_TOOLS.includes(toolName)) return 'approve';
    if (EDIT_TOOLS.includes(toolName)) return 'approve';
    if (toolName === 'Task') return 'approve';
    return 'escalate';
  }

  /**
   * Aggressive: approve most tools, including safe Bash commands
   */
  private evaluateAggressive(
    toolName: string,
    toolInput: unknown,
    detail: string
  ): EvaluationResult {
    if (READONLY_TOOLS.includes(toolName)) return 'approve';
    if (EDIT_TOOLS.includes(toolName)) return 'approve';
    if (toolName === 'Task') return 'approve';

    if (toolName === 'Bash') {
      return this.evaluateBashCommand(toolInput, detail);
    }

    // Unknown tools → escalate
    return 'escalate';
  }

  /**
   * Evaluate a Bash command for safety.
   * Checks against known dangerous patterns.
   */
  private evaluateBashCommand(toolInput: unknown, detail: string): EvaluationResult {
    // Try to extract the command from toolInput or detail
    const command = this.extractBashCommand(toolInput, detail);
    if (!command) return 'escalate';

    // Check against dangerous patterns
    for (const pattern of DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(command)) {
        return 'escalate';  // Don't auto-deny — let user decide
      }
    }

    // Command seems safe — approve
    return 'approve';
  }

  private extractBashCommand(toolInput: unknown, detail: string): string | null {
    // toolInput is typically { command: "..." }
    if (toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
      const cmd = (toolInput as { command: unknown }).command;
      if (typeof cmd === 'string') return cmd;
    }

    // Fall back to detail string
    if (detail) return detail;

    return null;
  }
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

    return JSON.parse(row.permission_policy) as AgentPermissionPolicy;
  } catch {
    return null;
  }
}
