import { getBaseUrl, getAuthHeaders } from './api';
import { useFilePushStore } from '../stores/filePushStore';

/**
 * Download a file from the server using the streaming download endpoint.
 * Uses fetch + ReadableStream for progress tracking, then triggers browser download.
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
      triggerBrowserDownload(blob, item.fileName);
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

    triggerBrowserDownload(blob, item.fileName);
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
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
