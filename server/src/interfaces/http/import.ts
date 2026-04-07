import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { expandTilde, type ImportResult, type ScanResult } from './import-shared.js';
import { ImportService } from '../../infrastructure/services/import-service.js';

interface ScanRequest {
  claudeCliPath: string;
}

interface ImportRequest {
  claudeCliPath: string;
  imports: Array<{
    sessionId: string;
    projectPath: string;
    targetProjectId: string;
  }>;
  options: {
    conflictStrategy: 'skip' | 'overwrite' | 'rename';
  };
}


export function createImportRoutes(db: Database.Database): Router {
  const router = Router();
  const importService = new ImportService(db);

  // Scan Claude CLI directory for sessions
  router.post('/claude-cli/scan', (req: Request, res: Response) => {
    try {
      const { claudeCliPath: rawPath } = req.body as ScanRequest;

      if (!rawPath) {
        res.json({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'claudeCliPath is required' }
        } as ApiResponse<never>);
        return;
      }

      // Expand ~ to home directory
      const claudeCliPath = expandTilde(rawPath);

      // Check if directory exists
      if (!fs.existsSync(claudeCliPath)) {
        res.json({
          success: false,
          error: { code: 'DIRECTORY_NOT_FOUND', message: `Directory not found: ${claudeCliPath}` }
        } as ApiResponse<never>);
        return;
      }

      const projectsDir = path.join(claudeCliPath, 'projects');

      if (!fs.existsSync(projectsDir)) {
        res.json({
          success: false,
          error: { code: 'NO_PROJECTS', message: 'No projects directory found' }
        } as ApiResponse<never>);
        return;
      }

      const projects = importService.scanClaudeProjects(projectsDir);

      res.json({
        success: true,
        data: { projects }
      } as ApiResponse<ScanResult>);
    } catch (error) {
      console.error('Error scanning Claude CLI directory:', error);
      res.json({
        success: false,
        error: {
          code: 'SCAN_ERROR',
          message: error instanceof Error ? error.message : 'Failed to scan directory'
        }
      } as ApiResponse<never>);
    }
  });

  // Import selected sessions
  router.post('/claude-cli/import', async (req: Request, res: Response) => {
    try {
      const { claudeCliPath: rawPath, imports, options } = req.body as ImportRequest;

      if (!rawPath || !imports || !Array.isArray(imports)) {
        res.json({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid request parameters' }
        } as ApiResponse<never>);
        return;
      }

      // Expand ~ to home directory
      const claudeCliPath = expandTilde(rawPath);

      const result = await importService.importClaudeSessions(claudeCliPath, imports, options);

      res.json({
        success: true,
        data: result
      } as ApiResponse<ImportResult>);
    } catch (error) {
      console.error('Error importing sessions:', error);
      res.json({
        success: false,
        error: {
          code: 'IMPORT_ERROR',
          message: error instanceof Error ? error.message : 'Failed to import sessions'
        }
      } as ApiResponse<never>);
    }
  });

  return router;
}
