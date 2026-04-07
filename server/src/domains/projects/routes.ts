import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import type { Project } from '@my-claudia/shared/core/project';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { ProjectRepository } from './repository.js';
import {
  applyProjectPatch,
  assertValidProjectState,
  buildProjectCreateState,
  buildProjectPatch,
  isProjectValidationError,
} from './model.js';
import { listGitWorktrees, createGitWorktree } from '../../utils/git-worktrees.js';

export type ProjectChangeEvent =
  | { type: 'project_upsert'; project: Project }
  | { type: 'project_remove'; projectId: string };

function ensureWorktreesGitignore(repoPath: string): void {
  const gitignorePath = path.join(repoPath, '.gitignore');
  const entry = '.worktrees/';
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.split('\n').some((line) => line.trim() === entry)) {
        fs.appendFileSync(gitignorePath, `\n${entry}\n`);
      }
    } else {
      fs.writeFileSync(gitignorePath, `${entry}\n`);
    }
  } catch {
    // Best effort only.
  }
}

export function createProjectRoutes(
  db: Database.Database,
  onProjectChanged?: (event?: ProjectChangeEvent) => void,
): Router {
  const router = Router();
  const repo = new ProjectRepository(db);

  router.get('/', (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: repo.findAllOrdered() } as ApiResponse<Project[]>);
    } catch (error) {
      console.error('Error fetching projects:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch projects' },
      });
    }
  });

  router.get('/:id', (req: Request, res: Response) => {
    try {
      const project = repo.findById(req.params.id);
      if (!project) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      res.json({
        success: true,
        data: project,
      } as ApiResponse<Project>);
    } catch (error) {
      console.error('Error fetching project:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch project' },
      });
    }
  });

  router.post('/', (req: Request, res: Response) => {
    try {
      const sortOrder = repo.findNextSortOrder();
      const project = repo.create(buildProjectCreateState(req.body ?? {}, sortOrder));

      onProjectChanged?.({ type: 'project_upsert', project });
      res.status(201).json({ success: true, data: project } as ApiResponse<Project>);
    } catch (error) {
      console.error('Error creating project:', error);
      res.status(isProjectValidationError(error) ? 400 : 500).json({
        success: false,
        error: {
          code: isProjectValidationError(error) ? 'VALIDATION_ERROR' : 'DB_ERROR',
          message: isProjectValidationError(error) ? error.message : 'Failed to create project',
        },
      });
    }
  });

  router.put('/:id', (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      const patch = buildProjectPatch(body);
      const existing = repo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      const nextState = applyProjectPatch(existing, patch);
      const updatedProjectState = {
        ...existing,
        ...nextState,
      };
      const validatedPatch = {
        ...patch,
        name: patch.name === undefined ? undefined : updatedProjectState.name,
        type: patch.type === undefined ? undefined : updatedProjectState.type,
      } as Partial<Project>;
      assertValidProjectState(updatedProjectState);

      try {
        const project = repo.update(req.params.id, validatedPatch);
        onProjectChanged?.({ type: 'project_upsert', project });
      } catch (error) {
        if (error instanceof Error && error.message.includes('not found')) {
          res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Project not found' },
          });
          return;
        }
        throw error;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error updating project:', error);
      res.status(isProjectValidationError(error) ? 400 : 500).json({
        success: false,
        error: {
          code: isProjectValidationError(error) ? 'VALIDATION_ERROR' : 'DB_ERROR',
          message: isProjectValidationError(error) ? error.message : 'Failed to update project',
        },
      });
    }
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const projectId = req.params.id;

    try {
      const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
      if (!project) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      const result = db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' },
        });
        return;
      }

      console.log(`[Delete Project] Successfully deleted project ${projectId}`);
      onProjectChanged?.({ type: 'project_remove', projectId });
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error deleting project:', error);
      if (error && typeof error === 'object' && 'code' in error) {
        console.error('[Delete Project] SQLite error code:', (error as any).code);
      }
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete project' },
      });
    }
  });

  router.get('/:id/worktrees', (req: Request, res: Response) => {
    const projectId = req.params.id;
    try {
      const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as { root_path: string | null } | undefined;
      if (!project) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
        return;
      }
      if (!project.root_path) {
        res.json({ success: true, data: [] });
        return;
      }
      const worktrees = listGitWorktrees(project.root_path);
      res.json({ success: true, data: worktrees });
    } catch (error) {
      console.error('Error listing worktrees:', error);
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed to list worktrees' } });
    }
  });

  router.post('/:id/worktrees', (req: Request, res: Response) => {
    const projectId = req.params.id;
    const { branch: rawBranch, path: worktreePath } = req.body as { branch?: string; path?: string };

    try {
      const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as { root_path: string | null } | undefined;
      if (!project) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Project not found' } });
        return;
      }
      if (!project.root_path) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Project has no root path' } });
        return;
      }

      const branch = rawBranch?.trim() || `wt-${new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2')}`;
      const resolvedPath = worktreePath?.trim()
        || path.join(project.root_path, '.worktrees', branch.replace(/\//g, '-'));

      if (!worktreePath?.trim()) {
        ensureWorktreesGitignore(project.root_path);
      }

      const worktree = createGitWorktree(project.root_path, resolvedPath, branch.trim());
      res.json({ success: true, data: worktree });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create worktree';
      console.error('Error creating worktree:', error);
      res.status(500).json({ success: false, error: { code: 'GIT_ERROR', message: msg } });
    }
  });

  router.post('/reorder', (req: Request, res: Response) => {
    try {
      const { orderedIds } = req.body as { orderedIds?: string[] };
      if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'orderedIds must be a non-empty array' } });
        return;
      }

      const update = db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?');
      db.transaction(() => {
        for (let i = 0; i < orderedIds.length; i++) {
          update.run(i, orderedIds[i]);
        }
      })();

      onProjectChanged?.();
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error reordering projects:', error);
      res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed to reorder projects' } });
    }
  });

  return router;
}
