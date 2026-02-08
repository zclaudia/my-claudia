import { useServerStore } from '../stores/serverStore';

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
 * Upload a file to the server or gateway
 * Works for both local and Gateway modes
 */
export async function uploadFile(
  file: File,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadedFile> {
  const server = useServerStore.getState().getActiveServer();
  if (!server) {
    throw new Error('No active server');
  }

  // Determine upload URL (works for both local and Gateway)
  const baseUrl = server.address.includes('://')
    ? server.address
    : `http://${server.address}`;
  const uploadUrl = `${baseUrl}/api/files/upload`;

  const formData = new FormData();
  formData.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress
    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100)
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
        } catch (error) {
          reject(new Error('Failed to parse response'));
        }
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload aborted'));
    });

    xhr.open('POST', uploadUrl);

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

  // Check file size
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File size exceeds ${(maxSize / (1024 * 1024)).toFixed(0)}MB limit`
    };
  }

  // Check file type
  if (allowedTypes && !allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type} is not allowed`
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
  const server = useServerStore.getState().getActiveServer();
  if (!server) {
    throw new Error('No active server');
  }

  const baseUrl = server.address.includes('://')
    ? server.address
    : `http://${server.address}`;
  const downloadUrl = `${baseUrl}/api/files/${fileId}`;

  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  };

  const response = await fetch(downloadUrl, { headers });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const result = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Download failed');
  }

  return result.data;
}
