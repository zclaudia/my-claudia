import { getBaseUrl, getAuthHeaders } from './api';
import { useFilePushStore } from '../stores/filePushStore';

/** Check if running inside Tauri (desktop or Android) */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Save a blob to the Downloads folder using Tauri fs plugin.
 * Returns the absolute path of the saved file.
 */
async function saveFileTauri(blob: Blob, fileName: string): Promise<string> {
  const { downloadDir } = await import('@tauri-apps/api/path');
  const { writeFile, exists } = await import('@tauri-apps/plugin-fs');

  const dir = await downloadDir();
  // Deduplicate: if file exists, append (1), (2), etc.
  let filePath = `${dir}/${fileName}`;
  const dotIdx = fileName.lastIndexOf('.');
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : '';
  let counter = 1;
  while (await exists(filePath)) {
    filePath = `${dir}/${base} (${counter})${ext}`;
    counter++;
  }

  const buffer = await blob.arrayBuffer();
  await writeFile(filePath, new Uint8Array(buffer));
  return filePath;
}

/**
 * Download a file from the server using the streaming download endpoint.
 * On Tauri desktop, saves to Downloads folder with path tracking.
 * On web/Android, triggers the browser's native download dialog.
 */
export async function downloadPushedFile(fileId: string): Promise<void> {
  const store = useFilePushStore.getState();
  const item = store.items.find((i) => i.fileId === fileId);
  if (!item) {
    console.warn(`[fileDownload] No push item found for fileId: ${fileId}`);
    return;
  }

  store.updateStatus(fileId, 'downloading');

  try {
    const baseUrl = getBaseUrl();
    const authHeaders = getAuthHeaders();

    const response = await fetch(`${baseUrl}/api/files/${fileId}/download`, {
      headers: authHeaders,
    });

    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const contentLength = Number(response.headers.get('Content-Length') || 0);
    const reader = response.body?.getReader();

    if (!reader) {
      // Fallback: no streaming support, just get blob directly
      const blob = await response.blob();
      await saveOrDownload(blob, item.fileName, fileId);
      store.updateStatus(fileId, 'completed');
      return;
    }

    // Stream with progress tracking
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      receivedBytes += value.length;

      if (contentLength > 0) {
        const progress = Math.round((receivedBytes / contentLength) * 100);
        store.updateProgress(fileId, progress);
      }
    }

    // Combine chunks into a single blob
    const blob = new Blob(chunks as BlobPart[], {
      type: response.headers.get('Content-Type') || 'application/octet-stream',
    });

    await saveOrDownload(blob, item.fileName, fileId);
    store.updateStatus(fileId, 'completed');
  } catch (error) {
    console.error(`[fileDownload] Failed to download ${fileId}:`, error);
    store.updateStatus(
      fileId,
      'error',
      error instanceof Error ? error.message : 'Download failed'
    );
  }
}

/**
 * Save to Downloads folder on Tauri desktop, or trigger browser download otherwise.
 */
async function saveOrDownload(blob: Blob, fileName: string, fileId: string): Promise<void> {
  if (isTauri()) {
    try {
      const savedPath = await saveFileTauri(blob, fileName);
      useFilePushStore.getState().updateSavedPath(fileId, savedPath);
      console.log(`[fileDownload] Saved to: ${savedPath}`);
      return;
    } catch (err) {
      console.warn('[fileDownload] Tauri save failed, falling back to browser download:', err);
    }
  }
  triggerBrowserDownload(blob, fileName);
}

/**
 * Trigger the browser's native download dialog.
 */
function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Open a file with the system's default application (Tauri desktop only).
 */
export async function openFile(filePath: string): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-shell');
  await open(filePath);
}

/**
 * Open the folder containing a file in the system file manager (Tauri desktop only).
 */
export async function openFolder(filePath: string): Promise<void> {
  const { open } = await import('@tauri-apps/plugin-shell');
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await open(dir);
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
