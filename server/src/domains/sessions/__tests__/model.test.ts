import { describe, expect, it } from 'vitest';
import {
  buildTaskExecutingSessionPatch,
  buildTaskPlanningSession,
  buildTaskPlannedSessionPatch,
  buildTaskUnlockedSessionPatch,
  buildSessionUpdatePatch,
  buildUnlockedSessionState,
  isSessionValidationError,
  normalizeSessionCreateInput,
} from '../model.js';

describe('sessions model', () => {
  it('normalizes create input strings and nullables', () => {
    expect(normalizeSessionCreateInput({
      projectId: '  project-1  ',
      name: '  Demo  ',
      providerId: null,
      parentSessionId: '  parent-1  ',
      workingDirectory: '  /tmp/work  ',
    })).toEqual({
      projectId: 'project-1',
      name: 'Demo',
      providerId: undefined,
      type: undefined,
      parentSessionId: 'parent-1',
      workingDirectory: '/tmp/work',
    });
  });

  it('builds update patch with trim and explicit null clearing', () => {
    expect(buildSessionUpdatePatch({
      name: '  Updated  ',
      providerId: null,
      sdkSessionId: '  sdk-1  ',
    })).toEqual({
      name: 'Updated',
      providerId: null,
      sdkSessionId: 'sdk-1',
    });
  });

  it('builds unlocked task-session state', () => {
    expect(buildUnlockedSessionState({
      type: 'background',
      parentSessionId: 'parent-1',
      projectRole: 'task',
    })).toEqual({
      type: 'background',
      parentSessionId: 'parent-1',
      projectRole: 'task',
      planStatus: 'planning',
    });
  });

  it('recognizes session validation errors', () => {
    expect(isSessionValidationError(new Error('Project ID is required'))).toBe(true);
    expect(isSessionValidationError(new Error('Regular sessions cannot have a parent session'))).toBe(true);
    expect(isSessionValidationError(new Error('Something unexpected'))).toBe(false);
  });

  it('builds task session lifecycle helpers', () => {
    expect(buildTaskPlanningSession({
      projectId: 'project-1',
      title: 'Implement feature',
      taskId: 'task-1',
      parentSessionId: 'main-1',
      providerId: 'provider-1',
      workingDirectory: '/repo',
    })).toEqual({
      projectId: 'project-1',
      name: 'Task: Implement feature',
      type: 'regular',
      projectRole: 'task',
      taskId: 'task-1',
      parentSessionId: 'main-1',
      providerId: 'provider-1',
      workingDirectory: '/repo',
      planStatus: 'planning',
    });

    expect(buildTaskExecutingSessionPatch('/worktree')).toEqual({
      workingDirectory: '/worktree',
      planStatus: 'executing',
      isReadOnly: true,
      sdkSessionId: null,
    });
    expect(buildTaskPlannedSessionPatch()).toEqual({
      planStatus: 'planned',
      isReadOnly: true,
    });
    expect(buildTaskUnlockedSessionPatch()).toEqual({
      planStatus: null,
      isReadOnly: false,
    });
  });
});
