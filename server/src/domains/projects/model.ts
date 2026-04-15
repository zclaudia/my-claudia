import type { Project, PermissionPolicy, ProjectType } from '@my-claudia/shared/core/project';

type ProjectStateFields = Pick<
  Project,
  'name' | 'type' | 'providerId' | 'rootPath' | 'systemPrompt' |
  'reviewProviderId' | 'permissionWorkflowOverrideId' | 'agent' | 'permissionPolicy' | 'agentPermissionOverride' |
  'sortOrder'
>;

type ProjectPatch = {
  [K in keyof ProjectStateFields]?: ProjectStateFields[K] | null;
};

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertJsonObject(value: unknown, field: string): void {
  if (value == null) return;
  if (!isPlainObject(value)) {
    throw new Error(`${field} must be an object when provided`);
  }
}

function assertPermissionPolicy(policy: PermissionPolicy | null | undefined): void {
  if (policy == null) return;
  if (!Array.isArray(policy.allowedTools) || !Array.isArray(policy.disallowedTools)) {
    throw new Error('permissionPolicy must include allowedTools and disallowedTools arrays');
  }
}

function assertRequiredProjectFields(project: Pick<Project, 'name' | 'type'>): void {
  if (!project.name || !project.name.trim()) {
    throw new Error('Name is required');
  }

  if (!project.type) {
    throw new Error('Type is required');
  }
}

export function assertValidProjectState(
  project: Pick<Project, 'name' | 'type' | 'reviewProviderId' | 'permissionWorkflowOverrideId' | 'agent' | 'permissionPolicy' | 'agentPermissionOverride'>,
): void {
  assertRequiredProjectFields(project);
  assertJsonObject(project.permissionPolicy, 'permissionPolicy');
  assertJsonObject(project.agentPermissionOverride, 'agentPermissionOverride');
  assertPermissionPolicy(project.permissionPolicy);

  if (project.reviewProviderId && project.type !== 'code') {
    throw new Error('reviewProviderId can only be set for code projects');
  }

  if (project.agent && project.type !== 'code') {
    throw new Error('Supervisor agent can only be configured for code projects');
  }
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function isProjectValidationError(error: unknown): error is Error {
  return error instanceof Error
    && (
      error.message.includes('must')
      || error.message.includes('only')
      || error.message.includes('include')
      || error.message.includes('required')
    );
}

export function buildProjectCreateState(
  body: Record<string, unknown>,
  sortOrder: number,
): Omit<Project, 'id' | 'createdAt' | 'updatedAt'> {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    throw new Error('Name is required');
  }

  const type = (body.type as ProjectType | undefined) ?? 'code';
  const project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'> = {
    name,
    type,
    providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
    rootPath: typeof body.rootPath === 'string' ? body.rootPath : undefined,
    systemPrompt: typeof body.systemPrompt === 'string' ? body.systemPrompt : undefined,
    permissionPolicy: (body.permissionPolicy as PermissionPolicy | undefined) ?? undefined,
    agentPermissionOverride: (body.agentPermissionOverride as Project['agentPermissionOverride'] | undefined) ?? undefined,
    reviewProviderId: typeof body.reviewProviderId === 'string' ? body.reviewProviderId : undefined,
    permissionWorkflowOverrideId: typeof body.permissionWorkflowOverrideId === 'string' ? body.permissionWorkflowOverrideId : undefined,
    agent: (body.agent as Project['agent'] | undefined) ?? undefined,
    sortOrder,
  };

  assertValidProjectState(project);
  return project;
}

export function buildProjectPatch(body: Record<string, unknown>): ProjectPatch {
  const patch: ProjectPatch = {};

  if (hasOwn(body, 'name')) patch.name = body.name == null ? null : String(body.name).trim();
  if (hasOwn(body, 'type')) patch.type = body.type == null ? null : body.type as ProjectType;
  if (hasOwn(body, 'providerId')) patch.providerId = body.providerId == null ? null : String(body.providerId);
  if (hasOwn(body, 'rootPath')) patch.rootPath = body.rootPath == null ? null : String(body.rootPath);
  if (hasOwn(body, 'systemPrompt')) patch.systemPrompt = body.systemPrompt == null ? null : String(body.systemPrompt);
  if (hasOwn(body, 'permissionPolicy')) patch.permissionPolicy = (body.permissionPolicy ?? null) as PermissionPolicy | null;
  if (hasOwn(body, 'agentPermissionOverride')) patch.agentPermissionOverride = (body.agentPermissionOverride ?? null) as Project['agentPermissionOverride'] | null;
  if (hasOwn(body, 'reviewProviderId')) patch.reviewProviderId = body.reviewProviderId == null ? null : String(body.reviewProviderId);
  if (hasOwn(body, 'permissionWorkflowOverrideId')) patch.permissionWorkflowOverrideId = body.permissionWorkflowOverrideId == null ? null : String(body.permissionWorkflowOverrideId);
  if (hasOwn(body, 'agent')) patch.agent = (body.agent ?? null) as Project['agent'] | null;

  return patch;
}

export function applyProjectPatch(
  existing: Project,
  patch: ProjectPatch,
): ProjectStateFields {
  const nextState: ProjectStateFields = {
    name: patch.name === undefined ? existing.name : (patch.name ?? ''),
    type: patch.type === undefined ? existing.type : (patch.type ?? '' as ProjectType),
    providerId: patch.providerId === undefined ? existing.providerId : patch.providerId ?? undefined,
    rootPath: patch.rootPath === undefined ? existing.rootPath : patch.rootPath ?? undefined,
    systemPrompt: patch.systemPrompt === undefined ? existing.systemPrompt : patch.systemPrompt ?? undefined,
    permissionPolicy: patch.permissionPolicy === undefined ? existing.permissionPolicy : patch.permissionPolicy ?? undefined,
    agentPermissionOverride: patch.agentPermissionOverride === undefined ? existing.agentPermissionOverride : patch.agentPermissionOverride ?? undefined,
    reviewProviderId: patch.reviewProviderId === undefined ? existing.reviewProviderId : patch.reviewProviderId ?? undefined,
    permissionWorkflowOverrideId: patch.permissionWorkflowOverrideId === undefined ? existing.permissionWorkflowOverrideId : patch.permissionWorkflowOverrideId ?? undefined,
    agent: patch.agent === undefined ? existing.agent : patch.agent ?? undefined,
    sortOrder: existing.sortOrder,
  };

  assertRequiredProjectFields(nextState);
  return nextState;
}
