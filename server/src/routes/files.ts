import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import multer from 'multer';
import type { ApiResponse, DirectoryListingResponse, FileEntry, FileContentResponse } from '@my-claudia/shared';
import { fileStore } from '../storage/fileStore.js';

// Directories to skip when listing
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'target',
  'vendor',
  '.idea',
  '.vscode',
  'coverage',
  '.nyc_output',
]);

// Security: Ensure path is within project root (prevent path traversal)
function isPathSafe(projectRoot: string, targetPath: string): boolean {
  const resolvedPath = path.resolve(projectRoot, targetPath);
  const normalizedRoot = path.resolve(projectRoot);
  return resolvedPath.startsWith(normalizedRoot + path.sep) || resolvedPath === normalizedRoot;
}

// Get file extension for categorization
function getExtension(name: string, isDir: boolean): string | undefined {
  if (isDir) return undefined;
  const ext = path.extname(name);
  return ext || undefined;
}

// Simple fuzzy match filter
function fuzzyMatch(query: string, name: string): boolean {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  const lowerName = name.toLowerCase();
  return lowerName.includes(lowerQuery);
}

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

export function createFilesRoutes(): Router {
  const router = Router();

  // POST /api/files/upload
  // Upload a file and get fileId
  router.post('/upload', (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            success: false,
            error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 10MB limit' }
          });
        }
        return res.status(400).json({
          success: false,
          error: { code: 'UPLOAD_ERROR', message: err.message }
        });
      }
      if (err) {
        return next(err);
      }

      try {
        if (!req.file) {
          res.status(400).json({
            success: false,
            error: { code: 'NO_FILE', message: 'No file provided' }
          });
          return;
        }

        // Convert to base64
        const base64Data = req.file.buffer.toString('base64');

        // Store file
        const fileId = fileStore.storeFile(
          req.file.originalname,
          req.file.mimetype,
          base64Data
        );

        res.json({
          success: true,
          data: {
            fileId,
            name: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size
          }
        });
      } catch (error) {
        console.error('[Files] Error uploading file:', error);
        res.status(500).json({
          success: false,
          error: { code: 'UPLOAD_ERROR', message: 'Failed to upload file' }
        });
      }
    });
  });

  // POST /api/files/upload-json
  // Upload a file via JSON body (used by gateway proxy which serializes as JSON)
  router.post('/upload-json', (req: Request, res: Response) => {
    try {
      const { name, mimeType, data } = req.body;

      if (!name || !mimeType || !data) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'name, mimeType, and data (base64) are required' }
        });
        return;
      }

      const size = Buffer.from(data, 'base64').length;
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (size > MAX_SIZE) {
        res.status(413).json({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 10MB limit' }
        });
        return;
      }

      const fileId = fileStore.storeFile(name, mimeType, data);

      res.json({
        success: true,
        data: { fileId, name, mimeType, size }
      });
    } catch (error) {
      console.error('[Files] Error uploading file (JSON):', error);
      res.status(500).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'Failed to upload file' }
      });
    }
  });

  // GET /api/files/list
  // Query params: projectRoot, relativePath, query, maxResults
  router.get('/list', (req: Request, res: Response) => {
    try {
      const {
        projectRoot,
        relativePath = '',
        query = '',
        maxResults = '50'
      } = req.query as Record<string, string>;

      if (!projectRoot) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'projectRoot is required' }
        });
        return;
      }

      // Normalize the relative path (remove leading/trailing slashes)
      const normalizedRelPath = relativePath.replace(/^\/+|\/+$/g, '');

      // Security check
      if (!isPathSafe(projectRoot, normalizedRelPath)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Path traversal not allowed' }
        });
        return;
      }

      const targetPath = path.join(projectRoot, normalizedRelPath);

      // Check if path exists
      if (!fs.existsSync(targetPath)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Directory not found' }
        });
        return;
      }

      const stat = fs.statSync(targetPath);
      if (!stat.isDirectory()) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PATH', message: 'Path is not a directory' }
        });
        return;
      }

      // Read directory contents
      const dirEntries = fs.readdirSync(targetPath, { withFileTypes: true });
      const maxResultsNum = parseInt(maxResults, 10) || 50;

      const entries: FileEntry[] = [];
      let hasMore = false;

      for (const entry of dirEntries) {
        // Skip hidden files (starting with .)
        if (entry.name.startsWith('.')) {
          continue;
        }

        // Skip ignored directories
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
          continue;
        }

        // Apply fuzzy filter
        if (!fuzzyMatch(query, entry.name)) {
          continue;
        }

        if (entries.length >= maxResultsNum) {
          hasMore = true;
          break;
        }

        const entryPath = normalizedRelPath ? `${normalizedRelPath}/${entry.name}` : entry.name;
        const fullPath = path.join(targetPath, entry.name);

        let size: number | undefined;
        if (entry.isFile()) {
          try {
            const fileStat = fs.statSync(fullPath);
            size = fileStat.size;
          } catch {
            // Ignore stat errors
          }
        }

        entries.push({
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          extension: getExtension(entry.name, entry.isDirectory()),
          size
        });
      }

      // Sort: directories first, then alphabetically
      entries.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      const response: DirectoryListingResponse = {
        entries,
        currentPath: normalizedRelPath,
        hasMore
      };

      res.json({ success: true, data: response } as ApiResponse<DirectoryListingResponse>);
    } catch (error) {
      console.error('Error listing directory:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to list directory' }
      });
    }
  });

  // GET /api/files/content
  // Query params: projectRoot, relativePath
  // Returns file content for @ mentions
  router.get('/content', (req: Request, res: Response) => {
    try {
      const { projectRoot, relativePath } = req.query as Record<string, string>;

      if (!projectRoot || !relativePath) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'projectRoot and relativePath are required' }
        });
        return;
      }

      // Security check
      if (!isPathSafe(projectRoot, relativePath)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Path traversal not allowed' }
        });
        return;
      }

      const fullPath = path.join(projectRoot, relativePath);

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'File not found' }
        });
        return;
      }

      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PATH', message: 'Path is a directory, not a file' }
        });
        return;
      }

      // Check file size (limit to 1MB to avoid memory issues)
      const MAX_FILE_SIZE = 1024 * 1024; // 1MB
      if (stat.size > MAX_FILE_SIZE) {
        res.status(400).json({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: 'File is too large (max 1MB)' }
        });
        return;
      }

      // Read file content
      const content = fs.readFileSync(fullPath, 'utf-8');

      const response: FileContentResponse = {
        path: relativePath,
        content,
        size: stat.size
      };

      res.json({ success: true, data: response } as ApiResponse<FileContentResponse>);
    } catch (error) {
      console.error('Error reading file:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to read file' }
      });
    }
  });

  // GET /api/files/:fileId
  // Retrieve a file by ID
  // NOTE: This must be defined AFTER /list and /content to avoid catching those paths
  router.get('/:fileId', (req: Request, res: Response) => {
    try {
      const { fileId } = req.params;

      const file = fileStore.getFile(fileId);
      if (!file) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'File not found' }
        });
        return;
      }

      res.json({
        success: true,
        data: {
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          data: file.data // base64
        }
      });
    } catch (error) {
      console.error('[Files] Error retrieving file:', error);
      res.status(500).json({
        success: false,
        error: { code: 'RETRIEVAL_ERROR', message: 'Failed to retrieve file' }
      });
    }
  });

  return router;
}
