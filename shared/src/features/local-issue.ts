// Local Issue Types

/**
 * Issue type discriminator.
 *
 * - 'feature': parent-only organizational container. Never carries a SpecChange.
 *   Status is restricted to 'open' | 'closed' | 'cancelled'.
 * - 'implement' | 'bug' | 'enhancement' | 'chore': sub-issue types that may
 *   carry a SpecChange and use the full 7-state status machine below.
 */
export type LocalIssueType =
  | 'feature'
  | 'implement'
  | 'bug'
  | 'enhancement'
  | 'chore';

/**
 * Status enum covering both parent (feature) and sub-issue lifecycles.
 *
 * Parent (type='feature') uses: open | closed | cancelled
 * Sub-issue uses the full set.
 *
 * Note: 'in_progress' (v1) is retained for backward compatibility with
 * existing local_issues records that pre-date G1. Code reading status must
 * treat legacy 'in_progress' as 'executing' for new-flow semantics. See
 * Task 3 for migration backfill.
 */
export type LocalIssueStatus =
  | 'open'
  | 'planning'
  | 'tasks_ready'
  | 'executing'
  | 'reviewing'
  | 'closed'
  | 'cancelled'
  | 'in_progress';  // legacy

export type LocalIssuePriority = 'low' | 'medium' | 'high' | 'critical';

export interface LocalIssue {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: LocalIssueStatus;
  priority: LocalIssuePriority;
  labels: string[];

  // G1 additions
  type: LocalIssueType;
  parentIssueId?: string;
  specChangeId?: string;
  isAnonymous: boolean;

  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

/**
 * A comment attached to a LocalIssue. No `author` field for v1 — the app is
 * single-user local-first; if Claude-generated comments need to be
 * distinguished later, add an `authorKind` column as a non-breaking change.
 */
export interface LocalIssueComment {
  id: string;
  issueId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

/** Reserved label marking an issue as "ready to execute" (e.g. saved from a
 *  plan-review interaction). UIs may render it specially (icon, filter). The
 *  label is shared semantics, not gated by source — manually created issues
 *  may also carry it. */
export const ACTIONABLE_LABEL = 'actionable';

/**
 * Derive a default title from plan markdown:
 *   1. First Markdown ATX heading text (`#` through `######`) → use it (trimmed)
 *   2. Else first non-empty trimmed line, truncated to 80 chars
 *   3. Else `Plan from <ISO timestamp>` fallback
 */
export function extractDefaultTitleFromPlan(planMarkdown: string): string {
  const lines = planMarkdown.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) {
      const text = m[1];
      if (text) return text;
    }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
  }
  return `Plan from ${new Date().toISOString()}`;
}
