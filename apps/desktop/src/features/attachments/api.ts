import type {
  Attachment,
  AttachmentCount,
  AttachmentOwnerKind,
} from '@my-claudia/shared';
import { useServerStore } from '../../stores/serverStore';
import { getControlPlaneMode, isLocalBackendId } from '../../utils/controlPlane';
import { apiCall } from '../../services/api/unwrap';
import { getBaseUrl, getAuthHeaders } from '../../services/api';
import { readFileAsBase64, type UploadProgress } from '../../services/fileUpload';

export interface UploadAttachmentOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Whether the active server requires routing through the gateway proxy. The
 * gateway can't forward multipart bodies, so we fall back to JSON+base64 in
 * that case (mirrors the legacy fileUpload.uploadFile behavior).
 */
function shouldUseGatewayJson(): boolean {
  const activeId = useServerStore.getState().activeServerId;
  const controlPlaneMode = getControlPlaneMode();
  return !!activeId && !(controlPlaneMode === 'embedded-local' && isLocalBackendId(activeId));
}

export async function listAttachments(
  ownerKind: AttachmentOwnerKind,
  ownerId: string,
): Promise<Attachment[]> {
  const params = new URLSearchParams({ ownerKind, ownerId });
  return apiCall<Attachment[]>(`/api/attachments?${params.toString()}`);
}

export async function listAttachmentCounts(
  ownerKind: AttachmentOwnerKind,
  ownerIds: string[],
): Promise<AttachmentCount[]> {
  if (ownerIds.length === 0) return [];
  const params = new URLSearchParams({
    ownerKind,
    ownerIds: ownerIds.join(','),
  });
  return apiCall<AttachmentCount[]>(`/api/attachments/counts?${params.toString()}`);
}

export async function deleteAttachment(id: string): Promise<void> {
  await apiCall<null>(`/api/attachments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function updateAttachment(
  id: string,
  patch: { name?: string; sortOrder?: number },
): Promise<Attachment> {
  return apiCall<Attachment>(`/api/attachments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Upload an attachment for a given owner. Picks the right transport based on
 * the active server's control-plane mode.
 */
export async function uploadAttachment(
  ownerKind: AttachmentOwnerKind,
  ownerId: string,
  file: File,
  options?: UploadAttachmentOptions,
): Promise<Attachment> {
  if (shouldUseGatewayJson()) {
    return uploadViaJson(ownerKind, ownerId, file, options);
  }
  return uploadViaMultipart(ownerKind, ownerId, file, options);
}

async function uploadViaJson(
  ownerKind: AttachmentOwnerKind,
  ownerId: string,
  file: File,
  options?: UploadAttachmentOptions,
): Promise<Attachment> {
  const baseUrl = getBaseUrl();
  const authHeaders = getAuthHeaders();
  const data = await readFileAsBase64(file);
  options?.onProgress?.({ loaded: file.size, total: file.size, percentage: 100 });

  const response = await fetch(`${baseUrl}/api/attachments/json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      ownerKind,
      ownerId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      data,
    }),
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}`);
  }
  const result = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Upload failed');
  }
  return result.data as Attachment;
}

async function uploadViaMultipart(
  ownerKind: AttachmentOwnerKind,
  ownerId: string,
  file: File,
  options?: UploadAttachmentOptions,
): Promise<Attachment> {
  const baseUrl = getBaseUrl();
  const authHeaders = getAuthHeaders() as Record<string, string>;

  return new Promise<Attachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${baseUrl}/api/attachments`);

    for (const [key, value] of Object.entries(authHeaders)) {
      xhr.setRequestHeader(key, value);
    }

    if (options?.onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          options.onProgress?.({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          });
        }
      });
    }

    if (options?.signal) {
      const abort = () => xhr.abort();
      if (options.signal.aborted) {
        abort();
      } else {
        options.signal.addEventListener('abort', abort, { once: true });
      }
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.success && result.data) {
            resolve(result.data as Attachment);
          } else {
            reject(new Error(result.error?.message || 'Upload failed'));
          }
        } catch {
          reject(new Error('Failed to parse response'));
        }
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    const form = new FormData();
    form.append('ownerKind', ownerKind);
    form.append('ownerId', ownerId);
    form.append('file', file);
    xhr.send(form);
  });
}

/**
 * Fetch the attachment bytes and turn them into a blob URL — required because
 * gateway-mode requests need an Authorization header, so a plain `<img src>`
 * pointing at /api/attachments/:id/raw doesn't work.
 *
 * Caller is responsible for calling URL.revokeObjectURL() on cleanup.
 */
export async function fetchAttachmentBlobUrl(id: string): Promise<string> {
  const baseUrl = getBaseUrl();
  const authHeaders = getAuthHeaders();
  const response = await fetch(`${baseUrl}/api/attachments/${encodeURIComponent(id)}/raw`, {
    headers: authHeaders,
  });
  if (!response.ok) {
    throw new Error(`Fetch attachment failed with status ${response.status}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Trigger a file download for an attachment. On Tauri desktop, saves to the
 * Downloads folder; otherwise triggers the browser download dialog.
 */
export async function downloadAttachment(id: string, fileName: string): Promise<void> {
  const baseUrl = getBaseUrl();
  const authHeaders = getAuthHeaders();
  const response = await fetch(`${baseUrl}/api/attachments/${encodeURIComponent(id)}/download`, {
    headers: authHeaders,
  });
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
