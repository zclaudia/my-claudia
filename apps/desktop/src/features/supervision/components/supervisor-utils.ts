import type { ProjectChange } from '@my-claudia/shared';

export interface ContextDocumentPreview {
  id: string;
  version: number;
  content: string;
}

export type PreviewDocTarget = 'design' | 'execution' | 'tasks';
export type EditableDocType = 'project' | 'architecture' | 'design' | 'execution' | 'tasks';

export const changeStatusLabel: Record<string, string> = {
  draft: 'Draft',
  designing: 'Designing',
  awaiting_design_review: 'Awaiting Design Review',
  planning: 'Planning',
  awaiting_execution_review: 'Awaiting Execution Review',
  executing: 'Executing',
  paused: 'Paused',
  accepting: 'Accepting',
  syncing: 'Syncing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function extractWorkspaceDocs(changeId: string | undefined, docs: Array<{ id: string; version?: number; content?: string }>): ContextDocumentPreview[] {
  const targetIds = [
    'baseline/project.md',
    'baseline/architecture.md',
    ...(changeId
      ? [
          `changes/${changeId}/design.md`,
          `changes/${changeId}/execution.md`,
          `changes/${changeId}/tasks.md`,
          `changes/${changeId}/acceptance.md`,
          `changes/${changeId}/sync-log.md`,
        ]
      : []),
  ];
  return targetIds
    .map((id) => docs.find((doc) => doc.id === id))
    .filter((doc): doc is { id: string; version?: number; content?: string } => Boolean(doc))
    .map((doc) => ({
      id: doc.id,
      version: typeof doc.version === 'number' ? doc.version : 1,
      content: doc.content ?? '',
    }));
}

export function formatDocLabel(docId: string): string {
  const fileName = docId.split('/').pop()?.replace('.md', '') ?? docId;
  if (docId === 'baseline/project.md') return 'Project';
  if (docId === 'baseline/architecture.md') return 'Architecture';
  if (fileName === 'design') return 'Design';
  if (fileName === 'execution') return 'Execution';
  if (fileName === 'tasks') return 'Tasks';
  if (fileName === 'acceptance') return 'Acceptance';
  if (fileName === 'sync-log') return 'Sync Log';
  return fileName;
}

export function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toISOString().slice(0, 10);
}

export function getEditableDocType(docId: string): EditableDocType | null {
  const fileName = docId.split('/').pop()?.replace('.md', '') ?? '';
  if (fileName === 'project' || fileName === 'architecture' || fileName === 'design' || fileName === 'execution' || fileName === 'tasks') {
    return fileName;
  }
  return null;
}

export function extractDocSummary(content: string, fallback: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return lines[0] ?? fallback;
}

export function hasBaselineDocs(docs: Array<{ id: string }>): boolean {
  return docs.some((doc) => doc.id === 'baseline/project.md' || doc.id === 'baseline/architecture.md');
}

export function getNextAction(status: ProjectChange['status']): { title: string; description: string } {
  switch (status) {
    case 'draft':
    case 'designing':
      return {
        title: 'Finish the design draft',
        description: 'Update scope and design details, then request design review.',
      };
    case 'awaiting_design_review':
      return {
        title: 'Review the design',
        description: 'Approve the design or send it back for revision before planning begins.',
      };
    case 'planning':
      return {
        title: 'Prepare execution',
        description: 'Finalize execution/tasks docs, then request execution review.',
      };
    case 'awaiting_execution_review':
      return {
        title: 'Approve execution',
        description: 'Confirm the execution plan before the supervisor starts implementation.',
      };
    case 'executing':
      return {
        title: 'Wait for task execution or request acceptance',
        description: 'Once task-level work is done, move the change into acceptance review.',
      };
    case 'accepting':
      return {
        title: 'Review acceptance',
        description: 'Approve acceptance to move into sync, or reopen execution if more work is needed.',
      };
    case 'syncing':
      return {
        title: 'Complete the change',
        description: 'Review the sync summary and mark the change completed when specs are aligned.',
      };
    case 'completed':
      return {
        title: 'No action required',
        description: 'This change is complete and remains available as read-only history.',
      };
    case 'cancelled':
      return {
        title: 'No action required',
        description: 'This change has been cancelled and stays in history for reference.',
      };
    default:
      return {
        title: 'Review current state',
        description: 'Check the current change status and continue from the latest checkpoint.',
      };
  }
}
