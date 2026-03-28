import type { DirectoryListingResponse, FileContentResponse } from '@my-claudia/shared';
import { apiCall, apiCallForBackend } from './unwrap';

export async function listDirectory(params: {
  projectRoot: string;
  relativePath?: string;
  query?: string;
  maxResults?: number;
  backendId?: string | null;
}): Promise<DirectoryListingResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    ...(params.relativePath && { relativePath: params.relativePath }),
    ...(params.query && { query: params.query }),
    ...(params.maxResults !== undefined && { maxResults: String(params.maxResults) })
  });

  return params.backendId
    ? apiCallForBackend<DirectoryListingResponse>(params.backendId, `/api/files/list?${queryParams}`)
    : apiCall<DirectoryListingResponse>(`/api/files/list?${queryParams}`);
}

export async function getFileContent(params: {
  projectRoot: string;
  relativePath: string;
  backendId?: string | null;
}): Promise<FileContentResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    relativePath: params.relativePath,
  });

  return params.backendId
    ? apiCallForBackend<FileContentResponse>(params.backendId, `/api/files/content?${queryParams}`)
    : apiCall<FileContentResponse>(`/api/files/content?${queryParams}`);
}
