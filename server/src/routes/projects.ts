import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { Project, ApiResponse, PermissionPolicy } from '@my-claudia/shared';

export function createProjectRoutes(db: Database.Database): Router {
  const router = Router();

  // Get all projects
  router.get('/', (_req: Request, res: Response) => {
    try {
      const projects = db.prepare(`
        SELECT id, name, type, provider_id as providerId, root_path as rootPath,
               system_prompt as systemPrompt, permission_policy as permissionPolicy,
               created_at as createdAt, updated_at as updatedAt
        FROM projects
        ORDER BY updated_at DESC
      `).all() as Array<Project & { permissionPolicy: string }>;

      const result = projects.map(p => ({
        ...p,
        permissionPolicy: p.permissionPolicy ? JSON.parse(p.permissionPolicy) : undefined
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
               created_at as createdAt, updated_at as updatedAt
        FROM projects WHERE id = ?
      `).get(req.params.id) as (Project & { permissionPolicy: string }) | undefined;

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
          permissionPolicy: project.permissionPolicy ? JSON.parse(project.permissionPolicy) : undefined
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
      const { name, type = 'code', providerId, rootPath, systemPrompt, permissionPolicy } = req.body;

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
        INSERT INTO projects (id, name, type, provider_id, root_path, system_prompt, permission_policy, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        type,
        providerId || null,
        rootPath || null,
        systemPrompt || null,
        permissionPolicy ? JSON.stringify(permissionPolicy) : null,
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
      const { name, type, providerId, rootPath, systemPrompt, permissionPolicy } = req.body;
      const now = Date.now();

      const result = db.prepare(`
        UPDATE projects
        SET name = COALESCE(?, name),
            type = COALESCE(?, type),
            provider_id = ?,
            root_path = ?,
            system_prompt = ?,
            permission_policy = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        name || null,
        type || null,
        providerId !== undefined ? providerId : null,
        rootPath !== undefined ? rootPath : null,
        systemPrompt !== undefined ? systemPrompt : null,
        permissionPolicy ? JSON.stringify(permissionPolicy) : null,
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

      // Disable recursive triggers to avoid FTS trigger conflicts
      db.pragma('recursive_triggers = OFF');

      let result;
      try {
        // Use a transaction and simple CASCADE deletion
        const deleteTransaction = db.transaction(() => {
          // Simply delete the project - CASCADE will handle all children
          return db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
        });

        result = deleteTransaction();
      } finally {
        // Always re-enable recursive triggers
        db.pragma('recursive_triggers = ON');
      }

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

  return router;
}
