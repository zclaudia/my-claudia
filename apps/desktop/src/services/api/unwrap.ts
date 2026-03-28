/**
 * ApiResponse unwrapper utilities.
 * Eliminates the repeated `fetchApi → check success → throw → return data` boilerplate
 * found in every feature API file.
 */
import { fetchApi, fetchApiForBackend } from './base';

/**
 * Call fetchApi and unwrap the ApiResponse — throws on failure, returns data on success.
 * Replaces the 3-line pattern:
 *   const result = await fetchApi<T>(path, options);
 *   if (!result.success || !result.data) throw new Error(result.error?.message || '...');
 *   return result.data;
 */
export async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const result = await fetchApi<T>(path, options);
  if (!result.success) {
    throw new Error(result.error?.message || `API call failed: ${options?.method || 'GET'} ${path}`);
  }
  return result.data as T;
}

export async function apiCallForBackend<T>(
  backendId: string | null | undefined,
  path: string,
  options?: RequestInit
): Promise<T> {
  const result = await fetchApiForBackend<T>(path, backendId, options);
  if (!result.success) {
    throw new Error(result.error?.message || `API call failed: ${options?.method || 'GET'} ${path}`);
  }
  return result.data as T;
}

/**
 * Same as apiCall but for void responses (DELETE, action endpoints that return no data).
 * Only checks `success`, does not expect `data`.
 */
export async function apiCallVoid(path: string, options?: RequestInit): Promise<void> {
  const result = await fetchApi<void>(path, options);
  if (!result.success) {
    throw new Error(result.error?.message || `API call failed: ${options?.method || 'GET'} ${path}`);
  }
}

export async function apiCallVoidForBackend(
  backendId: string | null | undefined,
  path: string,
  options?: RequestInit
): Promise<void> {
  const result = await fetchApiForBackend<void>(path, backendId, options);
  if (!result.success) {
    throw new Error(result.error?.message || `API call failed: ${options?.method || 'GET'} ${path}`);
  }
}
