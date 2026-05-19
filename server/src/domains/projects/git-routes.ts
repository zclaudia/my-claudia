import { Router } from 'express';
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import {
  ProjectWorktreeService,
  ProjectNotFoundError,
  ProjectRootPathMissingError,
  WorktreeNotFoundError,
  SupervisorManagedWorktreeError,
  MainWorktreeError,
} from './worktree-service.js';
import {
  GitOperationError,
  listBranches,
  getCommitLog,
  getGitStatus,
  getFileDiff,
  type GitFileDiffKind,
  listStash,
  createStash,
  applyStash,
  dropStash,
  stageFiles,
  unstageFiles,
  commitChanges,
  fetchRemote,
  pullRemote,
  pushRemote,
} from '../../utils/git-operations.js';

function sendError(res: Response, error: unknown, fallbackMessage: string): void {
  if (error instanceof ProjectNotFoundError) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: error.message } });
    return;
  }
  if (error instanceof WorktreeNotFoundError) {
    res.status(404).json({ success: false, error: { code: 'WORKTREE_NOT_FOUND', message: error.message } });
    return;
  }
  if (error instanceof ProjectRootPathMissingError) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
    return;
  }
  if (error instanceof SupervisorManagedWorktreeError) {
    res.status(409).json({ success: false, error: { code: 'SUPERVISOR_MANAGED', message: error.message } });
    return;
  }
  if (error instanceof MainWorktreeError) {
    res.status(409).json({ success: false, error: { code: 'MAIN_WORKTREE', message: error.message } });
    return;
  }
  if (error instanceof GitOperationError) {
    res.status(409).json({ success: false, error: { code: 'GIT_ERROR', message: error.message } });
    return;
  }
  const msg = error instanceof Error ? error.message : fallbackMessage;
  console.error(`[git-routes] ${fallbackMessage}:`, error);
  res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: msg } });
}

function getWorktreeParam(req: Request): string | null {
  if (req.method === 'GET') {
    const w = req.query.worktree;
    return typeof w === 'string' && w.trim() ? w : null;
  }
  const body = (req.body ?? {}) as { worktree?: unknown };
  return typeof body.worktree === 'string' && body.worktree.trim() ? body.worktree : null;
}

export function createGitRoutes(db: Database.Database): Router {
  const router = Router({ mergeParams: true });
  const service = new ProjectWorktreeService(db);

  // --- Worktree management ---

  router.delete('/:id/worktrees', async (req: Request, res: Response) => {
    const { path: worktreePath } = (req.body ?? {}) as { path?: string };
    if (!worktreePath || !worktreePath.trim()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'path is required' } });
      return;
    }
    try {
      await service.removeWorktree(req.params.id, worktreePath);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to remove worktree');
    }
  });

  router.get('/:id/worktrees/status', async (req: Request, res: Response) => {
    const wt = typeof req.query.path === 'string' ? req.query.path : '';
    if (!wt.trim()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'path is required' } });
      return;
    }
    try {
      const status = await service.getWorktreeStatus(req.params.id, wt);
      res.json({ success: true, data: status });
    } catch (error) {
      sendError(res, error, 'Failed to get worktree status');
    }
  });

  // --- Git read operations ---

  router.get('/:id/git/branches', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    if (!wt) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree is required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      const branches = await listBranches(worktreePath);
      res.json({ success: true, data: branches });
    } catch (error) {
      sendError(res, error, 'Failed to list branches');
    }
  });

  router.get('/:id/git/status', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    if (!wt) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree is required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      const status = await getGitStatus(worktreePath);
      res.json({ success: true, data: status });
    } catch (error) {
      sendError(res, error, 'Failed to get git status');
    }
  });

  router.get('/:id/git/diff', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    const file = typeof req.query.file === 'string' ? req.query.file : '';
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
    if (!wt || !file.trim() || !['staged', 'unstaged', 'untracked'].includes(kind)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree, file and kind are required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      const diff = await getFileDiff(worktreePath, file, kind as GitFileDiffKind);
      res.json({ success: true, data: { diff } });
    } catch (error) {
      sendError(res, error, 'Failed to get git diff');
    }
  });

  router.get('/:id/git/log', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    if (!wt) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree is required' } });
      return;
    }
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 50;
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      const log = await getCommitLog(worktreePath, limit);
      res.json({ success: true, data: log });
    } catch (error) {
      sendError(res, error, 'Failed to get commit log');
    }
  });

  router.get('/:id/git/stash', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    if (!wt) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree is required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      const stash = await listStash(worktreePath);
      res.json({ success: true, data: stash });
    } catch (error) {
      sendError(res, error, 'Failed to list stash');
    }
  });

  // --- Stash mutations ---

  router.post('/:id/git/stash', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    if (!wt) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree is required' } });
      return;
    }
    const { message } = (req.body ?? {}) as { message?: string };
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      await createStash(worktreePath, message);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to create stash');
    }
  });

  router.post('/:id/git/stash/apply', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    const { index } = (req.body ?? {}) as { index?: number };
    if (!wt || typeof index !== 'number') {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree and index are required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      await applyStash(worktreePath, index);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to apply stash');
    }
  });

  router.post('/:id/git/stash/drop', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    const { index } = (req.body ?? {}) as { index?: number };
    if (!wt || typeof index !== 'number') {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree and index are required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      await dropStash(worktreePath, index);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to drop stash');
    }
  });

  // --- Stage / unstage / commit ---

  router.post('/:id/git/stage', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    const { files } = (req.body ?? {}) as { files?: string[] };
    if (!wt || !Array.isArray(files)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree and files[] are required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      await stageFiles(worktreePath, files);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to stage files');
    }
  });

  router.post('/:id/git/unstage', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    const { files } = (req.body ?? {}) as { files?: string[] };
    if (!wt || !Array.isArray(files)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree and files[] are required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      await unstageFiles(worktreePath, files);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to unstage files');
    }
  });

  router.post('/:id/git/commit', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    const { message } = (req.body ?? {}) as { message?: string };
    if (!wt || !message || !message.trim()) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree and message are required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      const sha = await commitChanges(worktreePath, message);
      res.json({ success: true, data: { sha } });
    } catch (error) {
      sendError(res, error, 'Failed to commit changes');
    }
  });

  // --- Remote sync ---

  router.post('/:id/git/fetch', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    if (!wt) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree is required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      await fetchRemote(worktreePath);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to fetch');
    }
  });

  router.post('/:id/git/pull', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    if (!wt) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree is required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      await pullRemote(worktreePath);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to pull');
    }
  });

  router.post('/:id/git/push', async (req: Request, res: Response) => {
    const wt = getWorktreeParam(req);
    const { force } = (req.body ?? {}) as { force?: boolean };
    if (!wt) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'worktree is required' } });
      return;
    }
    try {
      const { worktreePath } = service.resolveWorktreeForGitOp(req.params.id, wt);
      await pushRemote(worktreePath, 'origin', undefined, !!force);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Failed to push');
    }
  });

  return router;
}
