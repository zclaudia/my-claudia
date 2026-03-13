import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLocalPRRoutes } from '../local-prs.js';

// Mock repositories as classes
vi.mock('../../repositories/project.js', () => {
  return {
    ProjectRepository: class MockProjectRepo {
      update = vi.fn().mockReturnValue({ id: 'proj-1', reviewProviderId: 'provider-1' });
    },
  };
});

vi.mock('../../repositories/worktree-config.js', () => {
  return {
    WorktreeConfigRepository: class MockWtConfigRepo {
      findByProjectId = vi.fn().mockReturnValue([]);
      upsert = vi.fn().mockReturnValue({ id: 'wc-1', worktreePath: '/path' });
    },
  };
});

const mockPR = {
  id: 'pr-1',
  projectId: 'proj-1',
  title: 'Test PR',
  status: 'open',
  executionState: 'idle',
  pendingAction: 'none',
};

function createMockService() {
  const repo = {
    findByProjectId: vi.fn().mockReturnValue([mockPR]),
    findById: vi.fn().mockReturnValue(mockPR),
    update: vi.fn().mockReturnValue(mockPR),
  };
  return {
    getRepo: vi.fn().mockReturnValue(repo),
    createPR: vi.fn().mockResolvedValue(mockPR),
    checkCreatePreconditions: vi.fn().mockResolvedValue({ canCreate: true }),
    archiveRelatedSessions: vi.fn(),
    startReview: vi.fn().mockResolvedValue(undefined),
    mergePR: vi.fn().mockResolvedValue(undefined),
    cancelMerge: vi.fn().mockResolvedValue(undefined),
    triggerConflictResolution: vi.fn().mockResolvedValue(undefined),
    reopenPR: vi.fn().mockResolvedValue(undefined),
    revertMergedPR: vi.fn().mockResolvedValue(undefined),
    _repo: repo,
  };
}

describe('local-prs routes', () => {
  let app: express.Express;
  let service: ReturnType<typeof createMockService>;
  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createMockService();
    app = express();
    app.use(express.json());
    app.use('/api', createLocalPRRoutes(service as any, mockDb));
  });

  describe('GET /api/projects/:projectId/local-prs', () => {
    it('lists PRs for a project', async () => {
      const res = await request(app).get('/api/projects/proj-1/local-prs');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([mockPR]);
    });

    it('returns 500 on error', async () => {
      service._repo.findByProjectId.mockImplementation(() => { throw new Error('DB error'); });
      const res = await request(app).get('/api/projects/proj-1/local-prs');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/projects/:projectId/local-prs', () => {
    it('creates a PR', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/local-prs')
        .send({ worktreePath: '/path', title: 'New PR' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 without worktreePath', async () => {
      const res = await request(app)
        .post('/api/projects/proj-1/local-prs')
        .send({ title: 'No path' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for duplicate PR', async () => {
      service.createPR.mockRejectedValue(new Error('already exists'));
      const res = await request(app)
        .post('/api/projects/proj-1/local-prs')
        .send({ worktreePath: '/path' });
      expect(res.status).toBe(400);
    });

    it('returns 500 for generic error', async () => {
      service.createPR.mockRejectedValue(new Error('Unexpected'));
      const res = await request(app)
        .post('/api/projects/proj-1/local-prs')
        .send({ worktreePath: '/path' });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/projects/:projectId/local-prs/precheck', () => {
    it('returns precheck result', async () => {
      const res = await request(app)
        .get('/api/projects/proj-1/local-prs/precheck?worktreePath=/path');
      expect(res.status).toBe(200);
      expect(res.body.data.canCreate).toBe(true);
    });

    it('returns 400 without worktreePath', async () => {
      const res = await request(app)
        .get('/api/projects/proj-1/local-prs/precheck');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/local-prs/:prId', () => {
    it('returns a PR', async () => {
      const res = await request(app).get('/api/local-prs/pr-1');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(mockPR);
    });

    it('returns 404 for missing PR', async () => {
      service._repo.findById.mockReturnValue(null);
      const res = await request(app).get('/api/local-prs/missing');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/local-prs/:prId/close', () => {
    it('closes a PR', async () => {
      const res = await request(app).post('/api/local-prs/pr-1/close');
      expect(res.status).toBe(200);
      expect(service.archiveRelatedSessions).toHaveBeenCalled();
    });

    it('returns 404 for missing PR', async () => {
      service._repo.findById.mockReturnValue(null);
      const res = await request(app).post('/api/local-prs/missing/close');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/local-prs/:prId/retry-review', () => {
    it('resets PR to open for retry', async () => {
      const res = await request(app).post('/api/local-prs/pr-1/retry-review');
      expect(res.status).toBe(200);
      expect(service._repo.update).toHaveBeenCalledWith('pr-1', { status: 'open' });
    });
  });

  describe('POST /api/local-prs/:prId/review', () => {
    it('starts a review', async () => {
      const res = await request(app)
        .post('/api/local-prs/pr-1/review')
        .send({ providerId: 'p1' });
      expect(res.status).toBe(200);
      expect(service.startReview).toHaveBeenCalledWith('pr-1', 'p1');
    });

    it('returns 400 for invalid status', async () => {
      service._repo.findById.mockReturnValue({ ...mockPR, status: 'merged' });
      const res = await request(app).post('/api/local-prs/pr-1/review');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });

    it('resets review_failed to open before starting', async () => {
      service._repo.findById.mockReturnValue({ ...mockPR, status: 'review_failed' });
      const res = await request(app).post('/api/local-prs/pr-1/review');
      expect(res.status).toBe(200);
      expect(service._repo.update).toHaveBeenCalledWith('pr-1', { status: 'open' });
    });
  });

  describe('POST /api/local-prs/:prId/merge', () => {
    it('triggers merge', async () => {
      const res = await request(app).post('/api/local-prs/pr-1/merge');
      expect(res.status).toBe(200);
      expect(service.mergePR).toHaveBeenCalledWith('pr-1');
    });

    it('returns 409 for dirty worktree', async () => {
      service.mergePR.mockRejectedValue(new Error('Main worktree is dirty'));
      const res = await request(app).post('/api/local-prs/pr-1/merge');
      expect(res.status).toBe(409);
    });

    it('returns 400 for invalid status', async () => {
      service.mergePR.mockRejectedValue(new Error('Cannot merge PR in status closed'));
      const res = await request(app).post('/api/local-prs/pr-1/merge');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/local-prs/:prId/cancel-merge', () => {
    it('cancels a merge', async () => {
      const res = await request(app).post('/api/local-prs/pr-1/cancel-merge');
      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid status', async () => {
      service.cancelMerge.mockRejectedValue(new Error('Cannot cancel merge in status open'));
      const res = await request(app).post('/api/local-prs/pr-1/cancel-merge');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/local-prs/:prId/cancel-queue', () => {
    it('cancels a queued PR', async () => {
      service._repo.findById.mockReturnValue({ ...mockPR, executionState: 'queued' });
      const res = await request(app).post('/api/local-prs/pr-1/cancel-queue');
      expect(res.status).toBe(200);
      expect(service._repo.update).toHaveBeenCalledWith('pr-1', {
        executionState: 'idle',
        pendingAction: 'none',
        statusMessage: 'Queue cancelled by user.',
      });
    });

    it('returns 400 if not queued', async () => {
      service._repo.findById.mockReturnValue({ ...mockPR, executionState: 'idle' });
      const res = await request(app).post('/api/local-prs/pr-1/cancel-queue');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  describe('POST /api/local-prs/:prId/retry', () => {
    it('retries a failed PR', async () => {
      service._repo.findById.mockReturnValue({ ...mockPR, executionState: 'failed' });
      const res = await request(app).post('/api/local-prs/pr-1/retry');
      expect(res.status).toBe(200);
      expect(service._repo.update).toHaveBeenCalledWith('pr-1', {
        executionState: 'queued',
        executionError: undefined,
      });
    });

    it('returns 400 if not failed', async () => {
      service._repo.findById.mockReturnValue({ ...mockPR, executionState: 'idle' });
      const res = await request(app).post('/api/local-prs/pr-1/retry');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/local-prs/:prId/resolve-conflict', () => {
    it('triggers conflict resolution', async () => {
      const res = await request(app).post('/api/local-prs/pr-1/resolve-conflict');
      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid status', async () => {
      service.triggerConflictResolution.mockRejectedValue(new Error('Cannot resolve conflict in status open'));
      const res = await request(app).post('/api/local-prs/pr-1/resolve-conflict');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/local-prs/:prId/reopen', () => {
    it('reopens a PR', async () => {
      const res = await request(app).post('/api/local-prs/pr-1/reopen');
      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid status', async () => {
      service.reopenPR.mockRejectedValue(new Error('Cannot reopen PR in status open'));
      const res = await request(app).post('/api/local-prs/pr-1/reopen');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/local-prs/:prId/revert-merge', () => {
    it('reverts a merged PR', async () => {
      const res = await request(app).post('/api/local-prs/pr-1/revert-merge');
      expect(res.status).toBe(200);
    });

    it('returns 409 for dirty worktree', async () => {
      service.revertMergedPR.mockRejectedValue(new Error('Main worktree is dirty'));
      const res = await request(app).post('/api/local-prs/pr-1/revert-merge');
      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /api/projects/:projectId/review-provider', () => {
    it('sets review provider', async () => {
      const res = await request(app)
        .patch('/api/projects/proj-1/review-provider')
        .send({ providerId: 'provider-1' });
      expect(res.status).toBe(200);
    });

    it('returns 400 without providerId', async () => {
      const res = await request(app)
        .patch('/api/projects/proj-1/review-provider')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/projects/:projectId/worktree-configs', () => {
    it('lists worktree configs', async () => {
      const res = await request(app).get('/api/projects/proj-1/worktree-configs');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('PUT /api/projects/:projectId/worktree-configs', () => {
    it('upserts a worktree config', async () => {
      const res = await request(app)
        .put('/api/projects/proj-1/worktree-configs')
        .send({ worktreePath: '/path', autoCreatePR: true, autoReview: false });
      expect(res.status).toBe(200);
    });

    it('returns 400 without worktreePath', async () => {
      const res = await request(app)
        .put('/api/projects/proj-1/worktree-configs')
        .send({ autoCreatePR: true });
      expect(res.status).toBe(400);
    });
  });
});
