// shared/src/features/epic.ts
//
// C5: `Epic` is the container that groups related LocalIssues by theme.
// Extracted out of `LocalIssueType = 'feature' | ...` because container vs.
// executable-condition concerns were conflated in the original model.
//
// - Epic has its own 3-state lifecycle (open / closed / cancelled)
// - Epic never carries a SpecChange (it's a folder, not a Change source)
// - LocalIssues reference their Epic via `epicId?: string` (optional — a
//   sub-issue can stand on its own without an Epic)

export type EpicStatus = 'open' | 'closed' | 'cancelled';

export interface Epic {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: EpicStatus;
  labels: string[];
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}
