import * as fs from 'fs';
import * as path from 'path';
import type { MessageAttachment } from '@my-claudia/shared';
import { fileStore } from '../storage/fileStore.js';

type FileKind = 'text' | 'binary';

const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/javascript',
  'application/typescript',
  'application/x-sh',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.xml', '.csv',
  '.tsv', '.log', '.ini', '.toml', '.conf', '.cfg', '.env', '.gitignore',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.go', '.rs',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.sh', '.bash', '.zsh', '.sql', '.html',
  '.css', '.scss', '.less', '.vue', '.svelte',
]);

function isTextMime(mimeType: string): boolean {
  const mime = (mimeType || '').toLowerCase();
  return mime.startsWith('text/') || TEXT_MIME_EXACT.has(mime);
}

function isTextExtension(fileName: string): boolean {
  const ext = path.extname(fileName || '').toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  for (const byte of buffer) {
    if (byte === 0) return true;
  }

  let controlBytes = 0;
  for (const byte of buffer) {
    const isCommonWhitespace = byte === 9 || byte === 10 || byte === 13;
    const isAsciiControl = byte < 32 && !isCommonWhitespace;
    if (isAsciiControl) controlBytes++;
  }

  return controlBytes / buffer.length > 0.1;
}

function classifyFile(attachment: MessageAttachment, filePath: string): FileKind {
  try {
    const fd = fs.openSync(filePath, 'r');
    const sniff = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, sniff, 0, sniff.length, 0);
    fs.closeSync(fd);
    const slice = sniff.subarray(0, bytesRead);
    if (looksBinary(slice)) return 'binary';
  } catch {
    return 'binary';
  }

  if (isTextMime(attachment.mimeType) || isTextExtension(attachment.name)) {
    return 'text';
  }

  return 'binary';
}

function buildTextPreview(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 64 * 1024) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    const trimmed = content.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 1200);
  } catch {
    return null;
  }
}

/**
 * Convert non-image attachments into concise prompt notes:
 * - text files: include path and optional small preview
 * - binary files: include path and usage hint only
 */
export function buildNonImageAttachmentNotes(attachments?: MessageAttachment[]): string[] {
  if (!attachments || attachments.length === 0) return [];

  const notes: string[] = [];
  for (const attachment of attachments) {
    if (attachment.type !== 'file') continue;

    const filePath = fileStore.getFilePath(attachment.fileId);
    if (!filePath) {
      notes.push(`[Attached file missing: ${attachment.name} (id=${attachment.fileId})]`);
      continue;
    }

    const kind = classifyFile(attachment, filePath);
    if (kind === 'text') {
      notes.push(`[Attached text file: ${attachment.name} path=${filePath}]`);
      const preview = buildTextPreview(filePath);
      if (preview) {
        notes.push(`[Text preview: ${attachment.name}]\n${preview}`);
      }
      continue;
    }

    notes.push(
      `[Attached binary artifact: ${attachment.name} path=${filePath}]` +
      ` (use for execute/package, do not read as text)`
    );
  }

  return notes;
}
