import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import type { Project, ApiResponse, PermissionPolicy } from '@my-claudia/shared';
import { listGitWorktrees, createGitWorktree } from '../utils/git-worktrees.js';

/** 确保 .worktrees 已加入 .gitignore，不存在则追加 */
function ensureWorktreesGitignore(repoPath: string): void {
  const gitignorePath = path.join(repoPath, '.gitignore');
  const entry = '.worktrees/';
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.split('\n').some(line => line.trim() === entry)) {
        fs.appendFileSync(gitignorePath, `\n${entry}\n`);
      }
    } else {
      fs.writeFileSync(gitignorePath, `${entry}\n`);
    }
  } catch {
    // 写入失败不阻断创建流程
  }
}

export function createProjectRoutes(db: Database.Database): Router {
  const router = Router();

  // Get all projects
  router.get('/', (_req: Request, res: Response) => {
    try {
      const projects = db.prepare(`
        SELECT id, name, type, provider_id as providerId, root_path as rootPath,
               system_prompt as systemPrompt, permission_policy as permissionPolicy,
               agent_permission_override as agentPermissionOverride,
               is_internal as isInternal,
               review_provider_id as reviewProviderId,
               created_at as createdAt, updated_at as updatedAt
        FROM projects
        ORDER BY updated_at DESC
      `).all() as any[];

      const result = projects.map(p => ({
        ...p,
        permissionPolicy: p.permissionPolicy ? JSON.parse(p.permissionPolicy) : undefined,
        agentPermissionOverride: p.agentPermissionOverride ? JSON.parse(p.agentPermissionOverride) : undefined,
        isInternal: p.isInternal === 1,
        reviewProviderId: p.reviewProviderId || undefined,
      }));

      res.json({ success: true, data: result } as ApiResponse<Project[]>);
    } catch (error) {
      console.error('Error fetching projects:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch projects' }
      });
    }
  });

  // Get single project
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const project = db.prepare(`
        SELECT id, name, type, provider_id as providerId, root_path as rootPath,
               system_prompt as systemPrompt, permission_policy as permissionPolicy,
               agent_permission_override as agentPermissionOverride,
               is_internal as isInternal,
               review_provider_id as reviewProviderId,
               created_at as createdAt, updated_at as updatedAt
        FROM projects WHERE id = ?
      `).get(req.params.id) as any | undefined;

      if (!project) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' }
        });
        return;
      }

      res.json({
        success: true,
        data: {
          ...project,
          permissionPolicy: project.permissionPolicy ? JSON.parse(project.permissionPolicy) : undefined,
          agentPermissionOverride: project.agentPermissionOverride ? JSON.parse(project.agentPermissionOverride) : undefined,
          isInternal: project.isInternal === 1,
          reviewProviderId: project.reviewProviderId || undefined,
        }
      } as ApiResponse<Project>);
    } catch (error) {
      console.error('Error fetching project:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch project' }
      });
    }
  });

  // Create project
  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, type = 'code', providerId, rootPath, systemPrompt, permissionPolicy, agentPermissionOverride } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Name is required' }
        });
        return;
      }

      const id = uuidv4();
      const now = Date.now();

      db.prepare(`
        INSERT INTO projects (id, name, type, provider_id, root_path, system_prompt, permission_policy, agent_permission_override, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        type,
        providerId || null,
        rootPath || null,
        systemPrompt || null,
        permissionPolicy ? JSON.stringify(permissionPolicy) : null,
        agentPermissionOverride ? JSON.stringify(agentPermissionOverride) : null,
        now,
        now
      );

      const project: Project = {
        id,
        name,
        type,
        providerId,
        rootPath,
        systemPrompt,
        permissionPolicy,
        agentPermissionOverride,
        createdAt: now,
        updatedAt: now
      };

      res.status(201).json({ success: true, data: project } as ApiResponse<Project>);
    } catch (error) {
      console.error('Error creating project:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create project' }
      });
    }
  });

  // Update project
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const { name, type, providerId, rootPath, systemPrompt, permissionPolicy, agentPermissionOverride, reviewProviderId } = req.body;
      const now = Date.now();

      const result = db.prepare(`
        UPDATE projects
        SET name = COALESCE(?, name),
            type = COALESCE(?, type),
            provider_id = ?,
            root_path = ?,
            system_prompt = ?,
            permission_policy = ?,
            agent_permission_override = ?,
            review_provider_id = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        name || null,
        type || null,
        providerId !== undefined ? providerId : null,
        rootPath !== undefined ? rootPath : null,
        systemPrompt !== undefined ? systemPrompt : null,
        permissionPolicy ? JSON.stringify(permissionPolicy) : null,
        agentPermissionOverride !== undefined
          ? (agentPermissionOverride ? JSON.stringify(agentPermissionOverride) : null)
          : null,
        reviewProviderId !== undefined ? (reviewProviderId || null) : null,
        now,
        req.params.id
      );

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' }
        });
        return;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error updating project:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update project' }
      });
    }
  });

  // Delete project
  router.delete('/:id', (req: Request, res: Response) => {
    const projectId = req.params.id;

    try {
      // Check if project exists
      const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
      if (!project) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' }
        });
        return;
      }

      const result = db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Project not found' }
        });
        return;
      }

      console.log(`[Delete Project] Successfully deleted project ${projectId}`);
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error deleting project:', error);

      // Log full error for debugging
      if (error && typeof error === 'object' && 'code' in error) {
        console.error('[Delete Project] SQLite error code:', (error as any).code);
      }

      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete project' }
      });
    }
  });

  // List git worktrees for a project
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

  // Create a new git worktree for a project
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

      // 自动生成分支名：wt-YYYYMMDD-HHMM
      const branch = rawBranch?.trim() || `wt-${new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2')}`;

      // 默认路径：.worktrees/<branch>（/ 替换为 -），自动加入 .gitignore
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

  return router;
}
