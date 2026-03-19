// Session Types

export type SessionType = 'regular' | 'background';

export interface Session {
  id: string;
  projectId: string;
  name?: string;
  providerId?: string;
  sdkSessionId?: string;
  type: SessionType;                // 'regular' = user-facing, 'background' = autonomous task
  parentSessionId?: string;          // Which session spawned this one (for background sessions)
  workingDirectory?: string;         // Session-specific working directory (e.g., for git worktree)
  createdAt: number;
  updatedAt: number;
  isActive?: boolean;  // Whether this session has an active AI request running
  archivedAt?: number; // Timestamp when session was archived, undefined = not archived

  // Supervision v2
  projectRole?: 'main' | 'task' | 'review' | 'checkpoint' | 'scheduled' | 'workflow';
  taskId?: string;
  planStatus?: 'planning' | 'planned' | 'executing' | null;
  isReadOnly?: boolean;
  lastRunStatus?: 'running' | 'waiting' | 'interrupted' | null;
}

// Session Draft Types

export interface SessionDraft {
  id: string;
  sessionId: string;
  content: string;
  editingBy?: string;    // Device ID currently editing (for edit locking)
  editingAt?: number;    // Lock timestamp
  updatedAt: number;
  archivedAt?: number;
}
