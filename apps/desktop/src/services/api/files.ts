import type { DirectoryListingResponse, FileContentResponse } from '@my-claudia/shared';
import { apiCall } from './unwrap';

export async function listDirectory(params: {
  projectRoot: string;
  relativePath?: string;
  query?: string;
  maxResults?: number;
}): Promise<DirectoryListingResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    ...(params.relativePath && { relativePath: params.relativePath }),
    ...(params.query && { query: params.query }),
    ...(params.maxResults !== undefined && { maxResults: String(params.maxResults) })
  });

  return apiCall<DirectoryListingResponse>(`/api/files/list?${queryParams}`);
}

export async function getFileContent(params: {
  projectRoot: string;
  relativePath: string;
}): Promise<FileContentResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    relativePath: params.relativePath,
  });

  return apiCall<FileContentResponse>(`/api/files/content?${queryParams}`);
}
