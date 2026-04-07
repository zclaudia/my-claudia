import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { Project } from '@my-claudia/shared/core/project';
import type { Session } from '@my-claudia/shared/core/session';
import type { ProjectAgent } from '@my-claudia/shared/features/supervision';

// ── AI Execution ─────────────────────────────────────────────────────

export interface SupervisionAiRunPort {
  startVirtualRun(args: {
    clientId: string;
    sessionId: string;
    input: string;
    workingDirectory: string;
    onMessage: (msg: ServerMessage) => void;
  }): Promise<void> | void;
}

// ── Scheduling ───────────────────────────────────────────────────────

export interface SupervisionSchedulingPort {
  register(task: {
    id: string;
    name: string;
    description?: string;
    category?: string;
    intervalMs?: number;
  }): void;
  markRunStart(taskId: string): void;
  markRunComplete(taskId: string, durationMs: number, error?: string): void;
}

// ── Cross-domain: Projects ───────────────────────────────────────────

/** What supervision needs from the projects domain — no concrete repo import */
export interface SupervisionProjectPort {
  findById(id: string): Project | undefined;
  findAll(): Project[];
  update(id: string, data: { agent?: ProjectAgent | null; contextSyncStatus?: 'synced' | 'error' }): Project;
}

// ── Cross-domain: Sessions ───────────────────────────────────────────

/** What supervision needs from the sessions domain — CRUD + role queries */
export interface SupervisionSessionPort {
  findById(id: string): Session | undefined;
  create(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session;
  update(id: string, data: Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>): Session;
  findByProjectRole(projectId: string, role: string): Session[];
}

/** Session model helpers that supervision needs to build task sessions */
export interface SupervisionSessionModelPort {
  buildTaskPlanningSession(seed: {
    projectId: string;
    title: string;
    taskId: string;
    parentSessionId?: string;
    providerId?: string;
    workingDirectory?: string;
  }): Omit<Session, 'id' | 'createdAt' | 'updatedAt'>;
  buildTaskExecutingSessionPatch(workingDirectory: string): Partial<Session>;
  buildTaskPlannedSessionPatch(): Partial<Session>;
  buildTaskUnlockedSessionPatch(): Partial<Session>;
}
