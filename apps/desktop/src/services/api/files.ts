import type { DirectoryListingResponse, FileContentResponse } from '@my-claudia/shared';
import { fetchApi } from './base';

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

  const result = await fetchApi<DirectoryListingResponse>(`/api/files/list?${queryParams}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to list directory');
  }
  return result.data;
}

export async function getFileContent(params: {
  projectRoot: string;
  relativePath: string;
}): Promise<FileContentResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    relativePath: params.relativePath,
  });

  const result = await fetchApi<FileContentResponse>(`/api/files/content?${queryParams}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch file content');
  }
  return result.data;
}
