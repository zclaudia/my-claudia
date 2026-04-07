import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { expandTilde, convertOpenCodeMessage, type ImportResult, type ScanResult, type OpenCodePartRow, type OpenCodeMessageData, type ConvertedMessage } from './import-shared.js';
import { ImportService } from '../services/import-service.js';

// Re-export for backward compatibility
export { convertOpenCodeMessage, type OpenCodePartRow, type OpenCodeMessageData, type ConvertedMessage };

// Request types
interface OpenCodeScanRequest {
  opencodePath?: string;
}

interface OpenCodeImportRequest {
  opencodePath?: string;
  imports: Array<{
    sessionId: string;
    targetProjectId: string;
  }>;
  options: {
    conflictStrategy: 'skip' | 'overwrite' | 'rename';
  };
}

export function getDefaultOpenCodeDbPath(): string {
  const platform = os.platform();
  if (platform === 'darwin') {
    const xdgDataHome = process.env.XDG_DATA_HOME;
    if (xdgDataHome) {
      return path.join(xdgDataHome, 'opencode', 'opencode.db');
    }
    return path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'opencode.db');
  }
  // Linux and others: XDG_DATA_HOME or ~/.local/share
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgDataHome, 'opencode', 'opencode.db');
}

export function createOpenCodeImportRoutes(db: Database.Database): Router {
  const router = Router();
  const importService = new ImportService(db);

  // Scan OpenCode database for sessions
  router.post('/opencode/scan', (req: Request, res: Response) => {
    try {
      const { opencodePath: rawPath } = req.body as OpenCodeScanRequest;

      // Use provided path or auto-detect
      const dbPath = rawPath ? expandTilde(rawPath) : getDefaultOpenCodeDbPath();

      // Check if file exists
      if (!fs.existsSync(dbPath)) {
        res.json({
          success: false,
          error: {
            code: 'DB_NOT_FOUND',
            message: `OpenCode database not found: ${dbPath}`
          }
        } as ApiResponse<never>);
        return;
      }

      const data = importService.scanOpenCodeDb(dbPath);

      res.json({
        success: true,
        data
      } as ApiResponse<ScanResult>);
    } catch (error) {
      console.error('Error scanning OpenCode database:', error);
      res.json({
        success: false,
        error: {
          code: 'SCAN_ERROR',
          message: error instanceof Error ? error.message : 'Failed to scan OpenCode database'
        }
      } as ApiResponse<never>);
    }
  });

  // Import selected sessions from OpenCode
  router.post('/opencode/import', (req: Request, res: Response) => {
    try {
      const { opencodePath: rawPath, imports, options } = req.body as OpenCodeImportRequest;

      if (!imports || !Array.isArray(imports)) {
        res.json({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid request parameters' }
        } as ApiResponse<never>);
        return;
      }

      const dbPath = rawPath ? expandTilde(rawPath) : getDefaultOpenCodeDbPath();

      if (!fs.existsSync(dbPath)) {
        res.json({
          success: false,
          error: {
            code: 'DB_NOT_FOUND',
            message: `OpenCode database not found: ${dbPath}`
          }
        } as ApiResponse<never>);
        return;
      }

      const result = importService.importOpenCodeSessions(dbPath, imports, options);

      res.json({
        success: true,
        data: result
      } as ApiResponse<ImportResult>);
    } catch (error) {
      console.error('Error importing OpenCode sessions:', error);
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
