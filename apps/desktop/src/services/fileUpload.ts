import { useServerStore } from '../stores/serverStore';
import { isGatewayTarget } from '../stores/gatewayStore';
import { getBaseUrl, getAuthHeaders } from './api';

export interface UploadedFile {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

/**
 * Read file as base64 data URL, return the base64 portion
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip "data:...;base64," prefix
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file to the server.
 * - Direct mode: multipart FormData to /api/files/upload
 * - Gateway mode: JSON body to /api/files/upload-json (gateway proxy serializes as JSON)
 */
export async function uploadFile(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadedFile> {
  const baseUrl = getBaseUrl();
  const authHeaders = getAuthHeaders();
  const activeId = useServerStore.getState().activeServerId;
  const viaGateway = isGatewayTarget(activeId);

  if (viaGateway) {
    // Gateway mode: send as JSON (gateway proxy can't forward multipart)
    const base64Data = await readFileAsBase64(file);

    onProgress?.({ loaded: file.size, total: file.size, percentage: 100 });

    const response = await fetch(`${baseUrl}/api/files/upload-json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type,
        data: base64Data,
      }),
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }

    const result = await response.json();
    if (!result.success || !result.data) {
      throw new Error(result.error?.message || 'Upload failed');
    }
    return result.data;
  }

  // Direct mode: multipart FormData with progress tracking
  const formData = new FormData();
  formData.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          });
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.success && result.data) {
            resolve(result.data);
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

    xhr.open('POST', `${baseUrl}/api/files/upload`);
    xhr.send(formData);
  });
}

/**
 * Validate file before upload
 */
export function validateFile(file: File, options?: {
  maxSize?: number;
  allowedTypes?: string[];
}): { valid: boolean; error?: string } {
  const maxSize = options?.maxSize || 10 * 1024 * 1024; // 10MB default
  const allowedTypes = options?.allowedTypes;

  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size exceeds ${(maxSize / (1024 * 1024)).toFixed(0)}MB limit`,
    };
  }

  if (allowedTypes && !allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type} is not allowed`,
    };
  }

  return { valid: true };
}

/**
 * Download file data from server
 */
export async function downloadFile(fileId: string): Promise<{
  fileId: string;
  name: string;
  mimeType: string;
  data: string; // base64
}> {
  const baseUrl = getBaseUrl();
  const authHeaders = getAuthHeaders();

  const response = await fetch(`${baseUrl}/api/files/${fileId}`, {
    headers: authHeaders,
  });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const result = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Download failed');
  }

  return result.data;
}
