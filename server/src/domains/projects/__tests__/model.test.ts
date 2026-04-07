import { describe, expect, it } from 'vitest';
import {
  applyProjectPatch,
  buildProjectCreateState,
  buildProjectPatch,
  isProjectValidationError,
} from '../model.js';
import type { Project } from '@my-claudia/shared/core/project';

describe('projects model', () => {
  it('builds create state with defaults and trims name', () => {
    const state = buildProjectCreateState({ name: '  Demo  ' }, 3);

    expect(state).toMatchObject({
      name: 'Demo',
      type: 'code',
      sortOrder: 3,
    });
  });

  it('rejects blank project names as validation errors', () => {
    const act = () => buildProjectCreateState({ name: '   ' }, 0);

    expect(act).toThrow('Name is required');
    try {
      act();
    } catch (error) {
      expect(isProjectValidationError(error)).toBe(true);
    }
  });

  it('builds patch objects with explicit null clearing', () => {
    const patch = buildProjectPatch({
      name: '  Updated  ',
      rootPath: null,
      reviewProviderId: null,
    });

    expect(patch).toEqual({
      name: 'Updated',
      rootPath: null,
      reviewProviderId: null,
    });
  });

  it('applies patch onto existing project state for validation', () => {
    const existing = {
      id: 'p1',
      name: 'Original',
      type: 'code',
      rootPath: '/repo',
      reviewProviderId: 'reviewer',
      createdAt: 1,
      updatedAt: 1,
    } as Project;

    const nextState = applyProjectPatch(existing, buildProjectPatch({
      type: 'chat_only',
      reviewProviderId: null,
    }));

    expect(nextState).toMatchObject({
      name: 'Original',
      type: 'chat_only',
      rootPath: '/repo',
      reviewProviderId: undefined,
    });
  });

  it('rejects patches that clear required fields', () => {
    const existing = {
      id: 'p1',
      name: 'Original',
      type: 'code',
      createdAt: 1,
      updatedAt: 1,
    } as Project;

    expect(() => applyProjectPatch(existing, buildProjectPatch({ name: null }))).toThrow('Name is required');
    expect(() => applyProjectPatch(existing, buildProjectPatch({ type: null }))).toThrow('Type is required');
  });
});
