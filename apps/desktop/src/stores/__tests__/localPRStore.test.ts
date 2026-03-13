import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLocalPRStore } from '../localPRStore';

vi.mock('../../services/api', () => ({
  listLocalPRs: vi.fn(),
  createLocalPR: vi.fn(),
  closeLocalPR: vi.fn(),
  retryLocalPRReview: vi.fn(),
  reviewLocalPR: vi.fn(),
  mergeLocalPR: vi.fn(),
  cancelLocalPRMerge: vi.fn(),
  resolveLocalPRConflict: vi.fn(),
  reopenLocalPR: vi.fn(),
  revertLocalPRMerge: vi.fn(),
  setProjectReviewProvider: vi.fn(),
}));

import {
  listLocalPRs,
  createLocalPR,
  closeLocalPR,
  retryLocalPRReview,
  reviewLocalPR,
  mergeLocalPR,
  cancelLocalPRMerge,
  resolveLocalPRConflict,
  reopenLocalPR,
  revertLocalPRMerge,
  setProjectReviewProvider,
} from '../../services/api';

const mockPR = (id: string, status = 'open') => ({
  id,
  projectId: 'proj-1',
  title: `PR ${id}`,
  status,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('localPRStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLocalPRStore.setState({ prs: {} });
  });

  it('loadPRs fetches and stores PRs', async () => {
    const prs = [mockPR('pr-1'), mockPR('pr-2')];
    vi.mocked(listLocalPRs).mockResolvedValue(prs as any);

    await useLocalPRStore.getState().loadPRs('proj-1');

    expect(useLocalPRStore.getState().prs['proj-1']).toEqual(prs);
  });

  it('createPR creates and upserts', async () => {
    const pr = mockPR('pr-1');
    vi.mocked(createLocalPR).mockResolvedValue(pr as any);

    const result = await useLocalPRStore.getState().createPR('proj-1', '/wt/1');

    expect(result).toEqual(pr);
    expect(useLocalPRStore.getState().prs['proj-1']).toContainEqual(pr);
  });

  it('closePR calls API and upserts', async () => {
    const pr = mockPR('pr-1', 'closed');
    vi.mocked(closeLocalPR).mockResolvedValue(pr as any);

    await useLocalPRStore.getState().closePR('pr-1', 'proj-1');

    expect(closeLocalPR).toHaveBeenCalledWith('pr-1');
    expect(useLocalPRStore.getState().prs['proj-1']).toContainEqual(pr);
  });

  it('retryReview calls API and upserts', async () => {
    const pr = mockPR('pr-1', 'open');
    vi.mocked(retryLocalPRReview).mockResolvedValue(pr as any);

    await useLocalPRStore.getState().retryReview('pr-1', 'proj-1');

    expect(retryLocalPRReview).toHaveBeenCalledWith('pr-1');
  });

  it('reviewPR calls API with optional providerId', async () => {
    const pr = mockPR('pr-1', 'reviewing');
    vi.mocked(reviewLocalPR).mockResolvedValue(pr as any);

    await useLocalPRStore.getState().reviewPR('pr-1', 'proj-1', 'prov-1');

    expect(reviewLocalPR).toHaveBeenCalledWith('pr-1', 'prov-1');
  });

  it('mergePR calls API and upserts', async () => {
    const pr = mockPR('pr-1', 'merged');
    vi.mocked(mergeLocalPR).mockResolvedValue(pr as any);

    await useLocalPRStore.getState().mergePR('pr-1', 'proj-1');

    expect(mergeLocalPR).toHaveBeenCalledWith('pr-1');
  });

  it('cancelMergePR calls API', async () => {
    const pr = mockPR('pr-1', 'approved');
    vi.mocked(cancelLocalPRMerge).mockResolvedValue(pr as any);

    await useLocalPRStore.getState().cancelMergePR('pr-1', 'proj-1');

    expect(cancelLocalPRMerge).toHaveBeenCalledWith('pr-1');
  });

  it('resolveConflictPR calls API', async () => {
    const pr = mockPR('pr-1');
    vi.mocked(resolveLocalPRConflict).mockResolvedValue(pr as any);

    await useLocalPRStore.getState().resolveConflictPR('pr-1', 'proj-1');

    expect(resolveLocalPRConflict).toHaveBeenCalledWith('pr-1');
  });

  it('reopenPR calls API', async () => {
    const pr = mockPR('pr-1', 'open');
    vi.mocked(reopenLocalPR).mockResolvedValue(pr as any);

    await useLocalPRStore.getState().reopenPR('pr-1', 'proj-1');

    expect(reopenLocalPR).toHaveBeenCalledWith('pr-1');
  });

  it('revertMergedPR calls API', async () => {
    const pr = mockPR('pr-1', 'open');
    vi.mocked(revertLocalPRMerge).mockResolvedValue(pr as any);

    await useLocalPRStore.getState().revertMergedPR('pr-1', 'proj-1');

    expect(revertLocalPRMerge).toHaveBeenCalledWith('pr-1');
  });

  it('setReviewProvider calls API', async () => {
    vi.mocked(setProjectReviewProvider).mockResolvedValue(undefined as any);

    await useLocalPRStore.getState().setReviewProvider('proj-1', 'prov-1');

    expect(setProjectReviewProvider).toHaveBeenCalledWith('proj-1', 'prov-1');
  });

  describe('upsertPR', () => {
    it('adds new PR', () => {
      const pr = mockPR('pr-1');
      useLocalPRStore.getState().upsertPR('proj-1', pr as any);

      expect(useLocalPRStore.getState().prs['proj-1']).toHaveLength(1);
    });

    it('updates existing PR', () => {
      const pr = mockPR('pr-1');
      useLocalPRStore.setState({ prs: { 'proj-1': [pr] as any[] } });

      const updated = { ...pr, status: 'merged' };
      useLocalPRStore.getState().upsertPR('proj-1', updated as any);

      expect(useLocalPRStore.getState().prs['proj-1']).toHaveLength(1);
      expect(useLocalPRStore.getState().prs['proj-1'][0].status).toBe('merged');
    });
  });

  describe('removePR', () => {
    it('removes PR from list', () => {
      useLocalPRStore.setState({ prs: { 'proj-1': [mockPR('pr-1'), mockPR('pr-2')] as any[] } });

      useLocalPRStore.getState().removePR('proj-1', 'pr-1');

      expect(useLocalPRStore.getState().prs['proj-1']).toHaveLength(1);
      expect(useLocalPRStore.getState().prs['proj-1'][0].id).toBe('pr-2');
    });

    it('handles missing project', () => {
      useLocalPRStore.getState().removePR('proj-1', 'pr-1');
      expect(useLocalPRStore.getState().prs['proj-1']).toEqual([]);
    });
  });
});
