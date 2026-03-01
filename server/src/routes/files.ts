import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import type { ApiResponse, DirectoryListingResponse, FileEntry, FileContentResponse, FilePushNotificationMessage, FilePushMetadata, ServerMessage } from '@my-claudia/shared';
import { fileStore } from '../storage/fileStore.js';
import type WebSocket from 'ws';

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

// Binary file extensions to exclude from text-based file search/viewing
const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg', '.tiff', '.tif', '.avif',
  // Audio / Video
  '.mp3', '.mp4', '.wav', '.ogg', '.flac', '.avi', '.mov', '.mkv', '.webm',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.zst',
  // Binaries / Executables
  '.exe', '.dll', '.so', '.dylib', '.a', '.o', '.obj', '.bin', '.apk', '.aab', '.ipa', '.deb', '.rpm',
  // Fonts
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // Documents (binary)
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Database
  '.db', '.sqlite', '.sqlite3',
  // Other
  '.class', '.pyc', '.pyo', '.wasm', '.DS_Store',
]);

function isBinaryExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

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

// Recursive file search: walk directory tree and collect matching files
function recursiveFileSearch(
  rootDir: string,
  projectRoot: string,
  query: string,
  maxResults: number,
): { entries: FileEntry[]; hasMore: boolean } {
  const entries: FileEntry[] = [];
  let hasMore = false;

  function walk(dir: string) {
    if (hasMore) return;
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of dirEntries) {
      if (hasMore) return;
      if (entry.name.startsWith('.')) continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        if (isBinaryExtension(entry.name)) continue;
        if (!fuzzyMatch(query, entry.name)) continue;
        if (entries.length >= maxResults) {
          hasMore = true;
          return;
        }

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(projectRoot, fullPath);
        let size: number | undefined;
        try {
          size = fs.statSync(fullPath).size;
        } catch { /* ignore */ }

        entries.push({
          name: entry.name,
          path: relPath,
          type: 'file',
          extension: getExtension(entry.name, false),
          size,
        });
      }
    }
  }

  walk(rootDir);
  return { entries, hasMore };
}

// Common MIME type lookup by extension
const MIME_TYPES: Record<string, string> = {
  '.apk': 'application/vnd.android.package-archive',
  '.ipa': 'application/octet-stream',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.tgz': 'application/gzip',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.ts': 'text/x-typescript',
  '.exe': 'application/x-msdownload',
  '.dmg': 'application/x-apple-diskimage',
  '.deb': 'application/x-debian-package',
  '.rpm': 'application/x-rpm',
  '.bin': 'application/octet-stream',
  '.iso': 'application/x-iso9660-image',
};

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/** Context for broadcasting messages to connected clients */
export interface FilesRouteBroadcastContext {
  sendMessage: (ws: WebSocket, message: ServerMessage) => void;
  getAuthenticatedClients: () => Array<{ ws: WebSocket }>;
  db: import('better-sqlite3').Database;
  getNextOffset: (sessionId: string) => number;
}

// Configure multer for streaming file upload (disk storage — no memory buffering)
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => {
      cb(null, `claudia-upload-${uuidv4()}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

export function createFilesRoutes(broadcastCtx?: FilesRouteBroadcastContext): Router {
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

        // req.file.path is the temp file on disk (streamed by multer disk storage)
        // Move it directly into the file store — no base64, no memory buffering
        const fileId = fileStore.storeFileByMoving(
          req.file.path,
          req.file.originalname,
          req.file.mimetype
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
        // Clean up temp file on error
        if (req.file?.path) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        }
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

      // Decode base64 once — use buffer for both size check and storage
      const buffer = Buffer.from(data, 'base64');
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (buffer.length > MAX_SIZE) {
        res.status(413).json({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 10MB limit' }
        });
        return;
      }

      const fileId = fileStore.storeFileFromBuffer(name, mimeType, buffer);

      res.json({
        success: true,
        data: { fileId, name, mimeType, size: buffer.length }
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

      const maxResultsNum = parseInt(maxResults, 10) || 50;

      let entries: FileEntry[];
      let hasMore: boolean;

      // When query is provided and browsing project root, do recursive search
      if (query && !normalizedRelPath) {
        const result = recursiveFileSearch(targetPath, projectRoot, query, maxResultsNum);
        entries = result.entries;
        hasMore = result.hasMore;
        // Sort alphabetically by path
        entries.sort((a, b) => a.path.localeCompare(b.path));
      } else {
        // Normal directory listing (non-recursive)
        const dirEntries = fs.readdirSync(targetPath, { withFileTypes: true });
        entries = [];
        hasMore = false;

        for (const entry of dirEntries) {
          if (entry.name.startsWith('.')) continue;
          if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
          if (query && entry.isFile() && isBinaryExtension(entry.name)) continue;
          if (!fuzzyMatch(query, entry.name)) continue;

          if (entries.length >= maxResultsNum) {
            hasMore = true;
            break;
          }

          const entryPath = normalizedRelPath ? `${normalizedRelPath}/${entry.name}` : entry.name;
          const fullPath = path.join(targetPath, entry.name);

          let size: number | undefined;
          if (entry.isFile()) {
            try {
              size = fs.statSync(fullPath).size;
            } catch { /* ignore */ }
          }

          entries.push({
            name: entry.name,
            path: entryPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            extension: getExtension(entry.name, entry.isDirectory()),
            size,
          });
        }

        // Sort: directories first, then alphabetically
        entries.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      }

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

      // Reject binary files by checking the first 8KB for null bytes
      const PROBE_SIZE = Math.min(8192, stat.size);
      if (PROBE_SIZE > 0) {
        const fd = fs.openSync(fullPath, 'r');
        const buf = Buffer.alloc(PROBE_SIZE);
        fs.readSync(fd, buf, 0, PROBE_SIZE, 0);
        fs.closeSync(fd);
        if (buf.includes(0)) {
          res.status(400).json({
            success: false,
            error: { code: 'BINARY_FILE', message: 'Binary files cannot be viewed as text' }
          });
          return;
        }
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

  // GET /api/files/:fileId/download
  // Stream download a file (supports large files without loading into memory)
  router.get('/:fileId/download', (req: Request, res: Response) => {
    try {
      const { fileId } = req.params;

      const metadata = fileStore.getFileMetadata(fileId);
      if (!metadata) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'File not found' }
        });
        return;
      }

      const filePath = fileStore.getFilePath(fileId);
      if (!filePath) {
        res.status(404).json({
          success: false,
          error: { code: 'FILE_MISSING', message: 'File data missing on disk' }
        });
        return;
      }

      // Set appropriate headers for download
      res.setHeader('Content-Type', metadata.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(metadata.name)}"`);
      res.setHeader('Content-Length', metadata.size.toString());

      // Stream the file
      const readStream = fs.createReadStream(filePath);
      readStream.pipe(res);

      readStream.on('error', (err) => {
        console.error(`[Files] Stream error for ${fileId}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: { code: 'STREAM_ERROR', message: 'Failed to stream file' }
          });
        }
      });
    } catch (error) {
      console.error('[Files] Error streaming file:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DOWNLOAD_ERROR', message: 'Failed to download file' }
      });
    }
  });

  // POST /api/files/push
  // Push a local file to connected clients
  router.post('/push', (req: Request, res: Response) => {
    try {
      const { filePath: sourcePath, sessionId, description } = req.body;

      if (!sourcePath) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'filePath is required' }
        });
        return;
      }

      if (!sessionId) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'sessionId is required' }
        });
        return;
      }

      // Validate file exists and is readable
      if (!fs.existsSync(sourcePath)) {
        res.status(404).json({
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: `File not found: ${sourcePath}` }
        });
        return;
      }

      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) {
        res.status(400).json({
          success: false,
          error: { code: 'NOT_A_FILE', message: 'Path is not a regular file' }
        });
        return;
      }

      // Detect MIME type and file name
      const fileName = path.basename(sourcePath);
      const mimeType = detectMimeType(sourcePath);
      const fileSize = stat.size;

      // Copy file into store
      const fileId = fileStore.storeFileFromPath(sourcePath, fileName, mimeType);

      // Determine auto-download: images or small files (< 500KB)
      const AUTO_DOWNLOAD_SIZE = 500 * 1024;
      const autoDownload = mimeType.startsWith('image/') || fileSize < AUTO_DOWNLOAD_SIZE;

      // Persist as a system message so offline clients see it in history
      let messageId: string | undefined;
      if (broadcastCtx) {
        const sessionExists = broadcastCtx.db.prepare(
          'SELECT 1 FROM sessions WHERE id = ?'
        ).get(sessionId);

        if (sessionExists) {
          messageId = uuidv4();
          const metadata: { filePush: FilePushMetadata } = {
            filePush: { fileId, fileName, mimeType, fileSize, description, autoDownload }
          };
          const offset = broadcastCtx.getNextOffset(sessionId);
          broadcastCtx.db.prepare(`
            INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
            VALUES (?, ?, 'system', ?, ?, ?, ?)
          `).run(messageId, sessionId, `File pushed: ${fileName}`, JSON.stringify(metadata), Date.now(), offset);
        }

        // Broadcast to connected clients via WebSocket
        const notification: FilePushNotificationMessage = {
          type: 'file_push',
          fileId,
          sessionId,
          fileName,
          mimeType,
          fileSize,
          description,
          autoDownload,
          messageId,
        };

        const clients = broadcastCtx.getAuthenticatedClients();
        for (const client of clients) {
          broadcastCtx.sendMessage(client.ws, notification);
        }

        console.log(`[Files] Pushed file ${fileId} (${fileName}, ${fileSize} bytes) to ${clients.length} client(s)`);
      }

      res.json({
        success: true,
        data: {
          fileId,
          fileName,
          mimeType,
          fileSize,
          autoDownload,
        }
      });
    } catch (error) {
      console.error('[Files] Error pushing file:', error);
      res.status(500).json({
        success: false,
        error: { code: 'PUSH_ERROR', message: 'Failed to push file' }
      });
    }
  });

  // GET /api/files/:fileId
  // Retrieve a file by ID
  // NOTE: This must be defined AFTER /list, /content, and /:fileId/download to avoid catching those paths
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
