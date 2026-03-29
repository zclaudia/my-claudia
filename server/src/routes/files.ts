import { Router, Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import type { ApiResponse, DirectoryListingResponse, FileContentResponse } from '@my-claudia/shared';
import { fileStore } from '../storage/fileStore.js';
import { FileBrowseError, FileBrowseService } from '../services/file-browse-service.js';
import {
  FileTransferError,
  FileTransferService,
  type FilesRouteBroadcastContext,
} from '../services/file-transfer-service.js';
import { sendApiError } from './response.js';

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
  const fileBrowseService = new FileBrowseService();
  const fileTransferService = new FileTransferService();

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
        const result = fileTransferService.storeUploadedTempFile(req.file);

        res.json({
          success: true,
          data: {
            fileId: result.fileId,
            name: result.name,
            mimeType: result.mimeType,
            size: result.size
          }
        });
      } catch (error) {
        if (error instanceof FileTransferError) {
          sendApiError(res, error.status, error.code, error.message);
          return;
        }
        // Clean up temp file on error
        if (req.file?.path) {
          try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
        }
        console.error('[Files] Error uploading file:', error);
        sendApiError(res, 500, 'UPLOAD_ERROR', 'Failed to upload file');
      }
    });
  });

  // POST /api/files/upload-json
  // Upload a file via JSON body (used by gateway proxy which serializes as JSON)
  router.post('/upload-json', (req: Request, res: Response) => {
    try {
      const { name, mimeType, data } = req.body;
      const result = fileTransferService.storeJsonUpload(name, mimeType, data);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      if (error instanceof FileTransferError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[Files] Error uploading file (JSON):', error);
      sendApiError(res, 500, 'UPLOAD_ERROR', 'Failed to upload file');
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

      const response = fileBrowseService.listDirectory(projectRoot, relativePath, query, maxResults);

      res.json({ success: true, data: response } as ApiResponse<DirectoryListingResponse>);
    } catch (error) {
      if (error instanceof FileBrowseError) {
        res.status(error.status).json({
          success: false,
          error: { code: error.code, message: error.message }
        });
        return;
      }
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
      const response = fileBrowseService.readFileContent(projectRoot, relativePath);

      res.json({ success: true, data: response } as ApiResponse<FileContentResponse>);
    } catch (error) {
      if (error instanceof FileBrowseError) {
        res.status(error.status).json({
          success: false,
          error: { code: error.code, message: error.message }
        });
        return;
      }
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
      const { filePath, metadata } = fileTransferService.resolveDownload(fileId);

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
      if (error instanceof FileTransferError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[Files] Error streaming file:', error);
      sendApiError(res, 500, 'DOWNLOAD_ERROR', 'Failed to download file');
    }
  });

  // POST /api/files/push
  // Push a local file to connected clients
  router.post('/push', (req: Request, res: Response) => {
    try {
      const { filePath: sourcePath, sessionId, description } = req.body;
      const result = fileTransferService.pushLocalFile(sourcePath, sessionId, description, broadcastCtx);

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      if (error instanceof FileTransferError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      console.error('[Files] Error pushing file:', error);
      sendApiError(res, 500, 'PUSH_ERROR', 'Failed to push file');
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
