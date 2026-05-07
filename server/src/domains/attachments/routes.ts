import { Router, type Request, type Response, type NextFunction } from 'express';
import * as fs from 'fs';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type {
  Attachment,
  AttachmentCount,
  AttachmentOwnerKind,
} from '@my-claudia/shared/features/attachment';
import { sendApiError } from '../../interfaces/http/response.js';
import { isValidOwnerKind } from './kind-detector.js';
import { checkOwnerAccess } from './access-control.js';
import type { AttachmentService } from './service.js';

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB — see design notes

function makeUploader(): multer.Multer {
  return multer({
    storage: multer.diskStorage({
      destination: os.tmpdir(),
      filename: (_req, _file, cb) => {
        cb(null, `claudia-attachment-${uuidv4()}`);
      },
    }),
    limits: { fileSize: MAX_UPLOAD_SIZE },
  });
}

function parseOwner(req: Request): { ownerKind: AttachmentOwnerKind; ownerId: string } | null {
  const ownerKind = (req.body?.ownerKind ?? req.query?.ownerKind) as unknown;
  const ownerId = (req.body?.ownerId ?? req.query?.ownerId) as unknown;
  if (!isValidOwnerKind(ownerKind) || typeof ownerId !== 'string' || !ownerId) {
    return null;
  }
  return { ownerKind, ownerId };
}

async function requireOwnerAccess(
  req: Request,
  res: Response,
  ownerKind: AttachmentOwnerKind,
  ownerId: string,
): Promise<boolean> {
  const ok = await checkOwnerAccess(ownerKind, ownerId, req);
  if (!ok) {
    sendApiError(res, 403, 'FORBIDDEN', 'Access denied for this owner');
  }
  return ok;
}

export function createAttachmentRoutes(service: AttachmentService): Router {
  const router = Router();
  const upload = makeUploader();

  // POST /api/attachments — multipart upload (direct mode)
  router.post('/attachments', (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, async (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          sendApiError(res, 413, 'FILE_TOO_LARGE', 'File exceeds 50MB limit');
          return;
        }
        sendApiError(res, 400, 'UPLOAD_ERROR', err.message);
        return;
      }
      if (err) {
        next(err);
        return;
      }

      const file = req.file;
      const owner = parseOwner(req);
      try {
        if (!file) {
          sendApiError(res, 400, 'NO_FILE', 'No file provided');
          return;
        }
        if (!owner) {
          sendApiError(res, 400, 'VALIDATION_ERROR', 'ownerKind and ownerId are required');
          return;
        }
        if (!(await requireOwnerAccess(req, res, owner.ownerKind, owner.ownerId))) return;

        const attachment = service.addFromTempFile({
          ownerKind: owner.ownerKind,
          ownerId: owner.ownerId,
          tempPath: file.path,
          name: file.originalname,
          mimeType: file.mimetype,
        });
        res.status(201).json({ success: true, data: attachment } as ApiResponse<Attachment>);
      } catch (error) {
        if (file?.path) {
          try {
            fs.unlinkSync(file.path);
          } catch {
            /* ignore */
          }
        }
        console.error('[Attachments] Upload failed:', error);
        sendApiError(res, 500, 'UPLOAD_ERROR', 'Failed to upload attachment');
      }
    });
  });

  // POST /api/attachments/json — base64 upload (gateway mode)
  router.post('/attachments/json', async (req: Request, res: Response) => {
    try {
      const owner = parseOwner(req);
      const { name, mimeType, data } = req.body ?? {};
      if (!owner) {
        sendApiError(res, 400, 'VALIDATION_ERROR', 'ownerKind and ownerId are required');
        return;
      }
      if (typeof name !== 'string' || typeof mimeType !== 'string' || typeof data !== 'string') {
        sendApiError(res, 400, 'VALIDATION_ERROR', 'name, mimeType, and data (base64) are required');
        return;
      }
      if (!(await requireOwnerAccess(req, res, owner.ownerKind, owner.ownerId))) return;

      const buffer = Buffer.from(data, 'base64');
      if (buffer.length > MAX_UPLOAD_SIZE) {
        sendApiError(res, 413, 'FILE_TOO_LARGE', 'File exceeds 50MB limit');
        return;
      }

      const attachment = service.addFromBuffer({
        ownerKind: owner.ownerKind,
        ownerId: owner.ownerId,
        buffer,
        name,
        mimeType,
      });
      res.status(201).json({ success: true, data: attachment } as ApiResponse<Attachment>);
    } catch (error) {
      console.error('[Attachments] JSON upload failed:', error);
      sendApiError(res, 500, 'UPLOAD_ERROR', 'Failed to upload attachment');
    }
  });

  // GET /api/attachments?ownerKind=&ownerId= — list owner's attachments
  router.get('/attachments', async (req: Request, res: Response) => {
    try {
      const owner = parseOwner(req);
      if (!owner) {
        sendApiError(res, 400, 'VALIDATION_ERROR', 'ownerKind and ownerId are required');
        return;
      }
      if (!(await requireOwnerAccess(req, res, owner.ownerKind, owner.ownerId))) return;

      const items = service.list(owner.ownerKind, owner.ownerId);
      res.json({ success: true, data: items } as ApiResponse<Attachment[]>);
    } catch (error) {
      console.error('[Attachments] List failed:', error);
      sendApiError(res, 500, 'LIST_ERROR', 'Failed to list attachments');
    }
  });

  // GET /api/attachments/counts?ownerKind=&ownerIds=a,b,c — bulk counts (badge optimization)
  router.get('/attachments/counts', async (req: Request, res: Response) => {
    try {
      const ownerKindRaw = req.query.ownerKind as unknown;
      const ownerIdsRaw = req.query.ownerIds as unknown;
      if (!isValidOwnerKind(ownerKindRaw)) {
        sendApiError(res, 400, 'VALIDATION_ERROR', 'ownerKind is required');
        return;
      }
      const ownerIds = typeof ownerIdsRaw === 'string'
        ? ownerIdsRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      if (ownerIds.length === 0) {
        res.json({ success: true, data: [] } as ApiResponse<AttachmentCount[]>);
        return;
      }

      const counts = service.countByOwners(ownerKindRaw, ownerIds);
      const result: AttachmentCount[] = ownerIds.map((id) => ({
        ownerKind: ownerKindRaw,
        ownerId: id,
        count: counts.get(id) ?? 0,
      }));
      res.json({ success: true, data: result } as ApiResponse<AttachmentCount[]>);
    } catch (error) {
      console.error('[Attachments] Counts failed:', error);
      sendApiError(res, 500, 'LIST_ERROR', 'Failed to count attachments');
    }
  });

  // GET /api/attachments/:id — metadata only
  router.get('/attachments/:id', async (req: Request, res: Response) => {
    try {
      const row = service.findById(req.params.id);
      if (!row) {
        sendApiError(res, 404, 'NOT_FOUND', 'Attachment not found');
        return;
      }
      if (!(await requireOwnerAccess(req, res, row.ownerKind, row.ownerId))) return;

      res.json({
        success: true,
        data: {
          id: row.id,
          ownerKind: row.ownerKind,
          ownerId: row.ownerId,
          name: row.name,
          mimeType: row.mimeType,
          size: row.size,
          kind: row.kind,
          width: row.width,
          height: row.height,
          sha256: row.sha256,
          createdBy: row.createdBy,
          sortOrder: row.sortOrder,
          createdAt: row.createdAt,
        } as Attachment,
      } as ApiResponse<Attachment>);
    } catch (error) {
      console.error('[Attachments] Get failed:', error);
      sendApiError(res, 500, 'GET_ERROR', 'Failed to get attachment');
    }
  });

  // GET /api/attachments/:id/raw — inline rendering (for <img>)
  router.get('/attachments/:id/raw', (req, res) => streamAttachment(req, res, service, 'inline'));

  // GET /api/attachments/:id/download — forced download
  router.get('/attachments/:id/download', (req, res) =>
    streamAttachment(req, res, service, 'attachment'),
  );

  // PATCH /api/attachments/:id — rename / reorder
  router.patch('/attachments/:id', async (req: Request, res: Response) => {
    try {
      const row = service.findById(req.params.id);
      if (!row) {
        sendApiError(res, 404, 'NOT_FOUND', 'Attachment not found');
        return;
      }
      if (!(await requireOwnerAccess(req, res, row.ownerKind, row.ownerId))) return;

      const { name, sortOrder } = req.body ?? {};
      const patch: { name?: string; sortOrder?: number } = {};
      if (typeof name === 'string' && name.trim()) patch.name = name.trim();
      if (typeof sortOrder === 'number' && Number.isFinite(sortOrder)) patch.sortOrder = sortOrder;

      const updated = service.update(req.params.id, patch);
      res.json({ success: true, data: updated } as ApiResponse<Attachment>);
    } catch (error) {
      console.error('[Attachments] Update failed:', error);
      sendApiError(res, 500, 'UPDATE_ERROR', 'Failed to update attachment');
    }
  });

  // DELETE /api/attachments/:id
  router.delete('/attachments/:id', async (req: Request, res: Response) => {
    try {
      const row = service.findById(req.params.id);
      if (!row) {
        sendApiError(res, 404, 'NOT_FOUND', 'Attachment not found');
        return;
      }
      if (!(await requireOwnerAccess(req, res, row.ownerKind, row.ownerId))) return;

      service.remove(req.params.id);
      res.json({ success: true, data: null } as ApiResponse<null>);
    } catch (error) {
      console.error('[Attachments] Delete failed:', error);
      sendApiError(res, 500, 'DELETE_ERROR', 'Failed to delete attachment');
    }
  });

  return router;
}

async function streamAttachment(
  req: Request,
  res: Response,
  service: AttachmentService,
  disposition: 'inline' | 'attachment',
): Promise<void> {
  try {
    const row = service.findById(req.params.id);
    if (!row) {
      sendApiError(res, 404, 'NOT_FOUND', 'Attachment not found');
      return;
    }
    if (!(await checkOwnerAccess(row.ownerKind, row.ownerId, req))) {
      sendApiError(res, 403, 'FORBIDDEN', 'Access denied for this owner');
      return;
    }

    const { attachmentStore } = await import('../../infrastructure/storage/attachmentStore.js');
    const absPath = attachmentStore.getPath(row.storageKey);
    if (!absPath) {
      sendApiError(res, 404, 'FILE_MISSING', 'Attachment data missing on disk');
      return;
    }

    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', row.size.toString());
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(row.name)}"`,
    );

    const stream = fs.createReadStream(absPath);
    stream.on('error', (streamErr) => {
      console.error(`[Attachments] Stream error for ${row.id}:`, streamErr);
      if (!res.headersSent) {
        sendApiError(res, 500, 'STREAM_ERROR', 'Failed to stream attachment');
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (error) {
    console.error('[Attachments] Stream failed:', error);
    if (!res.headersSent) {
      sendApiError(res, 500, 'STREAM_ERROR', 'Failed to stream attachment');
    }
  }
}
