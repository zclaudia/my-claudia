// apps/desktop/src/features/openspec/__tests__/handlers.test.ts
//
// Phase G8 — verify the OpenSpec WS handler refetches & updates the store
// for each of the 3 status-changed event variants.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleOpenSpecMessage } from '../handlers';
import { useOpenSpecStore } from '../store';
import * as api from '../api';
import type { ServerMessage } from '@my-claudia/shared';

describe('handleOpenSpecMessage', () => {
  beforeEach(() => {
    useOpenSpecStore.setState({
      issuesByProject: {},
      specChangesById: {},
      executorsBySpecChange: {},
      corpusByProject: {},
      viewByProject: {},
    });
    vi.restoreAllMocks();
  });

  it('executor_status_changed → refetches executors for the spec_change', async () => {
    const spy = vi.spyOn(api, 'listExecutors').mockResolvedValue([
      {
        id: 'e1',
        projectId: 'p1',
        specChangeId: 'sc1',
        type: 'manual',
        statusSummary: 'executing',
        createdAt: 0,
        updatedAt: 0,
      },
    ] as never);
    const msg: ServerMessage = {
      type: 'openspec_executor_status_changed',
      projectId: 'p1',
      executorInstanceId: 'e1',
      specChangeId: 'sc1',
      prev: 'pending',
      next: 'executing',
      at: Date.now(),
    };
    expect(handleOpenSpecMessage(msg)).toBe(true);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('sc1'));
    await vi.waitFor(() =>
      expect(useOpenSpecStore.getState().executorsBySpecChange.sc1?.[0]?.statusSummary).toBe(
        'executing',
      ),
    );
  });

  it('sub_issue_status_changed → refetches and upserts issue', async () => {
    const spy = vi.spyOn(api, 'getIssue').mockResolvedValue({
      id: 'i1',
      projectId: 'p1',
      title: 'A',
      status: 'planning',
      priority: 'medium',
      labels: [],
      type: 'implement',
      isAnonymous: false,
      createdAt: 0,
      updatedAt: 0,
    } as never);
    const msg: ServerMessage = {
      type: 'openspec_sub_issue_status_changed',
      projectId: 'p1',
      subIssueId: 'i1',
      prev: 'open',
      next: 'planning',
      at: Date.now(),
    };
    expect(handleOpenSpecMessage(msg)).toBe(true);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('i1'));
    await vi.waitFor(() =>
      expect(useOpenSpecStore.getState().issuesByProject.p1?.[0]?.status).toBe('planning'),
    );
  });

  it('spec_change_status_changed → refetches and sets spec_change', async () => {
    const spy = vi.spyOn(api, 'getSpecChange').mockResolvedValue({
      id: 'sc1',
      projectId: 'p1',
      subIssueId: 'i1',
      slug: 'x',
      title: 'X',
      status: 'tasks_ready',
      proposalPath: 'a',
      designPath: 'b',
      tasksPath: 'c',
      deltaSpecPaths: [],
      deltaPendingMerge: false,
      createdAt: 0,
      updatedAt: 0,
    } as never);
    const msg: ServerMessage = {
      type: 'openspec_spec_change_status_changed',
      projectId: 'p1',
      specChangeId: 'sc1',
      prev: 'designing',
      next: 'tasks_ready',
      at: Date.now(),
    };
    expect(handleOpenSpecMessage(msg)).toBe(true);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('sc1'));
    await vi.waitFor(() =>
      expect(useOpenSpecStore.getState().specChangesById.sc1?.status).toBe('tasks_ready'),
    );
  });

  it('returns false for unrelated messages', () => {
    const msg = { type: 'local_issue_update' } as ServerMessage;
    expect(handleOpenSpecMessage(msg)).toBe(false);
  });

  it('swallows api errors silently (no throw)', async () => {
    vi.spyOn(api, 'listExecutors').mockRejectedValue(new Error('network'));
    const msg: ServerMessage = {
      type: 'openspec_executor_status_changed',
      projectId: 'p1',
      executorInstanceId: 'e1',
      specChangeId: 'sc1',
      prev: 'pending',
      next: 'executing',
      at: Date.now(),
    };
    expect(() => handleOpenSpecMessage(msg)).not.toThrow();
  });
});
