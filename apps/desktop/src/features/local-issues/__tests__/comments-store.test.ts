import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalIssueCommentStore } from '../comments-store';

vi.mock('../api', () => ({
  listIssueComments: vi.fn(),
  createIssueComment: vi.fn(),
  updateIssueComment: vi.fn(),
  deleteIssueComment: vi.fn(),
}));

import * as api from '../api';

const mockedList = vi.mocked(api.listIssueComments);
const mockedCreate = vi.mocked(api.createIssueComment);
const mockedUpdate = vi.mocked(api.updateIssueComment);
const mockedDelete = vi.mocked(api.deleteIssueComment);

const makeComment = (overrides: Partial<{ id: string; issueId: string; body: string; createdAt: number; updatedAt: number }> = {}) => ({
  id: overrides.id ?? 'c1',
  issueId: overrides.issueId ?? 'i1',
  body: overrides.body ?? 'hello',
  createdAt: overrides.createdAt ?? 1000,
  updatedAt: overrides.updatedAt ?? 1000,
});

describe('useLocalIssueCommentStore', () => {
  beforeEach(() => {
    useLocalIssueCommentStore.setState({
      comments: {},
      loading: {},
      loaded: new Set(),
    });
    [mockedList, mockedCreate, mockedUpdate, mockedDelete].forEach((m) => m.mockReset());
  });

  it('loadComments fetches once and populates comments sorted by createdAt', async () => {
    mockedList.mockResolvedValueOnce([
      makeComment({ id: 'b', createdAt: 200 }),
      makeComment({ id: 'a', createdAt: 100 }),
    ]);
    await useLocalIssueCommentStore.getState().loadComments('i1');
    expect(useLocalIssueCommentStore.getState().comments['i1'].map((c) => c.id)).toEqual(['a', 'b']);
    expect(useLocalIssueCommentStore.getState().loaded.has('i1')).toBe(true);
  });

  it('loadComments is idempotent — second call does not refetch', async () => {
    mockedList.mockResolvedValueOnce([]);
    await useLocalIssueCommentStore.getState().loadComments('i1');
    await useLocalIssueCommentStore.getState().loadComments('i1');
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('refreshComments bypasses the loaded guard', async () => {
    mockedList.mockResolvedValueOnce([makeComment({ body: 'first' })]);
    mockedList.mockResolvedValueOnce([makeComment({ body: 'second' })]);
    await useLocalIssueCommentStore.getState().loadComments('i1');
    await useLocalIssueCommentStore.getState().refreshComments('i1');
    expect(mockedList).toHaveBeenCalledTimes(2);
    expect(useLocalIssueCommentStore.getState().comments['i1'][0].body).toBe('second');
  });

  it('addComment delegates to API and upserts the result', async () => {
    const created = makeComment({ body: 'fresh' });
    mockedCreate.mockResolvedValueOnce(created);
    await useLocalIssueCommentStore.getState().addComment('i1', 'fresh');
    expect(useLocalIssueCommentStore.getState().comments['i1']).toEqual([created]);
  });

  it('editComment replaces the existing comment in place', async () => {
    useLocalIssueCommentStore.getState().upsertComment(makeComment({ id: 'c1', body: 'old' }));
    mockedUpdate.mockResolvedValueOnce(makeComment({ id: 'c1', body: 'new', updatedAt: 2000 }));
    await useLocalIssueCommentStore.getState().editComment('c1', 'new');
    expect(useLocalIssueCommentStore.getState().comments['i1'][0].body).toBe('new');
  });

  it('upsertComment is idempotent — same id replaces, not duplicates', () => {
    useLocalIssueCommentStore.getState().upsertComment(makeComment({ id: 'c1', body: 'v1' }));
    useLocalIssueCommentStore.getState().upsertComment(makeComment({ id: 'c1', body: 'v2' }));
    expect(useLocalIssueCommentStore.getState().comments['i1']).toHaveLength(1);
    expect(useLocalIssueCommentStore.getState().comments['i1'][0].body).toBe('v2');
  });

  it('deleteCommentLocal removes from the issue\'s list', () => {
    useLocalIssueCommentStore.getState().upsertComment(makeComment({ id: 'c1' }));
    useLocalIssueCommentStore.getState().upsertComment(makeComment({ id: 'c2' }));
    useLocalIssueCommentStore.getState().deleteCommentLocal('i1', 'c1');
    expect(useLocalIssueCommentStore.getState().comments['i1'].map((c) => c.id)).toEqual(['c2']);
  });

  it('removeComment hits the API and updates the local store', async () => {
    useLocalIssueCommentStore.getState().upsertComment(makeComment({ id: 'c1' }));
    mockedDelete.mockResolvedValueOnce(undefined);
    await useLocalIssueCommentStore.getState().removeComment('c1');
    expect(mockedDelete).toHaveBeenCalledWith('c1');
    expect(useLocalIssueCommentStore.getState().comments['i1']).toEqual([]);
  });

  it('clearIssue drops all state for that issue and clears loaded flag', async () => {
    mockedList.mockResolvedValueOnce([makeComment({ id: 'c1' })]);
    await useLocalIssueCommentStore.getState().loadComments('i1');
    useLocalIssueCommentStore.getState().clearIssue('i1');
    expect(useLocalIssueCommentStore.getState().comments['i1']).toBeUndefined();
    expect(useLocalIssueCommentStore.getState().loaded.has('i1')).toBe(false);
  });
});
