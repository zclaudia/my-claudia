import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  FilePushMetadata,
  FilePushNotificationMessage,
  ServerMessage,
} from '@my-claudia/shared';
import type WebSocket from 'ws';
import { fileStore } from '../storage/fileStore.js';

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

const MAX_JSON_UPLOAD_SIZE = 10 * 1024 * 1024;
const AUTO_DOWNLOAD_SIZE = 500 * 1024;

export interface FilesRouteBroadcastContext {
  sendMessage: (ws: WebSocket, message: ServerMessage) => void;
  getAuthenticatedClients: () => Array<{ ws: WebSocket }>;
  db: import('better-sqlite3').Database;
  getNextOffset: (sessionId: string) => number;
}

export interface StoredUploadResult {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface DownloadFileResult {
  filePath: string;
  metadata: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    createdAt: number;
  };
}

export interface PushFileResult {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  autoDownload: boolean;
}

export interface UploadedFileInput {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export class FileTransferError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export class FileTransferService {
  storeUploadedTempFile(file: UploadedFileInput | undefined): StoredUploadResult {
    if (!file) {
      throw new FileTransferError(400, 'NO_FILE', 'No file provided');
    }

    const fileId = fileStore.storeFileByMoving(file.path, file.originalname, file.mimetype);
    return {
      fileId,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  storeJsonUpload(
    name: string | undefined,
    mimeType: string | undefined,
    data: string | undefined,
  ): StoredUploadResult {
    if (!name || !mimeType || !data) {
      throw new FileTransferError(
        400,
        'VALIDATION_ERROR',
        'name, mimeType, and data (base64) are required',
      );
    }

    const buffer = Buffer.from(data, 'base64');
    if (buffer.length > MAX_JSON_UPLOAD_SIZE) {
      throw new FileTransferError(413, 'FILE_TOO_LARGE', 'File exceeds 10MB limit');
    }

    const fileId = fileStore.storeFileFromBuffer(name, mimeType, buffer);
    return {
      fileId,
      name,
      mimeType,
      size: buffer.length,
    };
  }

  resolveDownload(fileId: string): DownloadFileResult {
    const metadata = fileStore.getFileMetadata(fileId);
    if (!metadata) {
      throw new FileTransferError(404, 'NOT_FOUND', 'File not found');
    }

    const filePath = fileStore.getFilePath(fileId);
    if (!filePath) {
      throw new FileTransferError(404, 'FILE_MISSING', 'File data missing on disk');
    }

    return { filePath, metadata };
  }

  pushLocalFile(
    sourcePath: string | undefined,
    sessionId: string | undefined,
    description: string | undefined,
    broadcastCtx?: FilesRouteBroadcastContext,
  ): PushFileResult {
    if (!sourcePath) {
      throw new FileTransferError(400, 'VALIDATION_ERROR', 'filePath is required');
    }

    if (!sessionId) {
      throw new FileTransferError(400, 'VALIDATION_ERROR', 'sessionId is required');
    }

    if (!fs.existsSync(sourcePath)) {
      throw new FileTransferError(404, 'FILE_NOT_FOUND', `File not found: ${sourcePath}`);
    }

    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) {
      throw new FileTransferError(400, 'NOT_A_FILE', 'Path is not a regular file');
    }

    const fileName = path.basename(sourcePath);
    const mimeType = detectMimeType(sourcePath);
    const fileSize = stat.size;
    const fileId = fileStore.storeFileFromPath(sourcePath, fileName, mimeType);
    const autoDownload = mimeType.startsWith('image/') || fileSize < AUTO_DOWNLOAD_SIZE;

    if (broadcastCtx) {
      this.persistPushMessageAndBroadcast(
        broadcastCtx,
        sessionId,
        {
          fileId,
          fileName,
          mimeType,
          fileSize,
          description,
          autoDownload,
        },
      );
    }

    return {
      fileId,
      fileName,
      mimeType,
      fileSize,
      autoDownload,
    };
  }

  private persistPushMessageAndBroadcast(
    broadcastCtx: FilesRouteBroadcastContext,
    sessionId: string,
    payload: {
      fileId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      description: string | undefined;
      autoDownload: boolean;
    },
  ): void {
    let messageId: string | undefined;
    const sessionExists = broadcastCtx.db.prepare(
      'SELECT 1 FROM sessions WHERE id = ?',
    ).get(sessionId);

    if (sessionExists) {
      messageId = uuidv4();
      const metadata: { filePush: FilePushMetadata } = {
        filePush: {
          fileId: payload.fileId,
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          fileSize: payload.fileSize,
          description: payload.description,
          autoDownload: payload.autoDownload,
        },
      };
      const offset = broadcastCtx.getNextOffset(sessionId);
      broadcastCtx.db.prepare(`
        INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
        VALUES (?, ?, 'system', ?, ?, ?, ?)
      `).run(
        messageId,
        sessionId,
        `File pushed: ${payload.fileName}`,
        JSON.stringify(metadata),
        Date.now(),
        offset,
      );
    }

    const notification: FilePushNotificationMessage = {
      type: 'file_push',
      fileId: payload.fileId,
      sessionId,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      description: payload.description,
      autoDownload: payload.autoDownload,
      messageId,
    };

    const clients = broadcastCtx.getAuthenticatedClients();
    for (const client of clients) {
      broadcastCtx.sendMessage(client.ws, notification);
    }

    console.log(
      `[Files] Pushed file ${payload.fileId} (${payload.fileName}, ${payload.fileSize} bytes) to ${clients.length} client(s)`,
    );
  }
}
