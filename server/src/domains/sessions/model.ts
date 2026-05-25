import type { Session, SessionType } from '@my-claudia/shared/core/session';

const VALID_SESSION_TYPES = new Set<SessionType>(['regular', 'background', 'agent']);
const BACKGROUND_ONLY_ROLES = new Set<NonNullable<Session['projectRole']>>([
  'review',
  'checkpoint',
  'scheduled',
  'workflow',
]);

export function normalizeSessionType(type: SessionType | null | undefined): SessionType {
  return type && VALID_SESSION_TYPES.has(type) ? type : 'regular';
}

export function assertValidSessionState(
  session: Pick<Session, 'type' | 'parentSessionId' | 'projectRole' | 'planStatus'>,
): void {
  if (!VALID_SESSION_TYPES.has(session.type)) {
    throw new Error(`Invalid session type: ${session.type}`);
  }

  if (session.parentSessionId && session.type === 'regular') {
    throw new Error('Regular sessions cannot have a parent session');
  }

  if (session.projectRole !== 'task' && session.planStatus != null) {
    throw new Error('Only task sessions can carry a plan status');
  }

  if (session.projectRole && BACKGROUND_ONLY_ROLES.has(session.projectRole) && session.type !== 'background') {
    throw new Error(`Session role '${session.projectRole}' requires background session type`);
  }

  if (session.projectRole === 'main' && session.type !== 'regular') {
    throw new Error('Main sessions must use regular session type');
  }
}

export function isPlanningTaskSession(session: Pick<Session, 'projectRole' | 'planStatus'>): boolean {
  return session.projectRole === 'task' && session.planStatus === 'planning';
}

export interface SessionCreateInput {
  projectId?: string;
  name?: string;
  providerId?: string | null;
  type?: SessionType | null;
  parentSessionId?: string | null;
  workingDirectory?: string | null;
}

export type SessionUpdatePatch = {
  [K in keyof Pick<Session, 'name' | 'providerId' | 'sdkSessionId'>]?: Session[K] | null;
};

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function isSessionValidationError(error: unknown): error is Error {
  return error instanceof Error
    && (
      error.message.includes('required')
      || error.message.includes('Invalid')
      || error.message.includes('cannot')
      || error.message.includes('must')
      || error.message.includes('Only')
    );
}

export function normalizeSessionCreateInput(input: SessionCreateInput): SessionCreateInput {
  return {
    projectId: normalizeOptionalString(input.projectId),
    name: normalizeOptionalString(input.name),
    providerId: input.providerId == null ? undefined : normalizeOptionalString(input.providerId),
    type: input.type ?? undefined,
    parentSessionId: input.parentSessionId == null ? undefined : normalizeOptionalString(input.parentSessionId),
    workingDirectory: input.workingDirectory == null ? undefined : normalizeOptionalString(input.workingDirectory),
  };
}

export function buildSessionUpdatePatch(body: Record<string, unknown>): SessionUpdatePatch {
  const patch: SessionUpdatePatch = {};

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    patch.name = body.name == null ? null : normalizeOptionalString(body.name);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'providerId')) {
    patch.providerId = body.providerId == null ? null : normalizeOptionalString(body.providerId);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'sdkSessionId')) {
    patch.sdkSessionId = body.sdkSessionId == null ? null : normalizeOptionalString(body.sdkSessionId);
  }

  return patch;
}

export function buildUnlockedSessionState(
  session: Pick<Session, 'type' | 'parentSessionId' | 'projectRole'>,
): Pick<Session, 'type' | 'parentSessionId' | 'projectRole' | 'planStatus'> {
  return {
    type: session.type,
    parentSessionId: session.parentSessionId,
    projectRole: session.projectRole,
    planStatus: session.projectRole === 'task' ? 'planning' : null,
  };
}

export interface TaskSessionSeed {
  projectId: string;
  title: string;
  taskId: string;
  parentSessionId?: string;
  providerId?: string;
  workingDirectory?: string;
}

export function buildTaskPlanningSession(seed: TaskSessionSeed): Omit<Session, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    projectId: seed.projectId,
    name: `Task: ${seed.title}`,
    type: 'regular',
    projectRole: 'task',
    taskId: seed.taskId,
    parentSessionId: seed.parentSessionId,
    providerId: seed.providerId,
    workingDirectory: seed.workingDirectory,
    planStatus: 'planning',
  };
}

export function buildTaskExecutingSessionPatch(
  workingDirectory: string,
): Pick<Session, 'workingDirectory' | 'planStatus' | 'isReadOnly' | 'sdkSessionId'> {
  return {
    workingDirectory,
    planStatus: 'executing',
    isReadOnly: true,
    sdkSessionId: null,
  };
}

export function buildTaskPlannedSessionPatch(): Pick<Session, 'planStatus' | 'isReadOnly'> {
  return {
    planStatus: 'planned',
    isReadOnly: true,
  };
}

export function buildTaskUnlockedSessionPatch(): Pick<Session, 'planStatus' | 'isReadOnly'> {
  return {
    planStatus: null,
    isReadOnly: false,
  };
}
