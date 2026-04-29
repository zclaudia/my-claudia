import { useCallback, useMemo } from 'react';
import { getAuthHeadersForBackend, getBaseUrlForBackend } from '../../services/api/base';

export function useAutomationApi(selectedBackendId: string | null, fallbackServerUrl: string, fallbackAuthToken: string) {
  const request = useCallback(async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    let baseUrl = fallbackServerUrl;
    let authorization = fallbackAuthToken;

    if (selectedBackendId) {
      try {
        baseUrl = getBaseUrlForBackend(selectedBackendId);
      } catch {
        // Fall back to the URL passed at window creation time until facade state is ready.
      }

      try {
        const resolvedAuth = (getAuthHeadersForBackend(selectedBackendId) as Record<string, string>)['Authorization'] || '';
        if (resolvedAuth) authorization = resolvedAuth;
      } catch {
        // Same as above — keep fallback auth while the shared registry is still warming up.
      }
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    const opts: RequestInit = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    if (!baseUrl) throw new Error('No backend connection available');
    const resp = await fetch(`${baseUrl}${path}`, opts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (method === 'DELETE') return;
    const json = await resp.json();
    if (!json.success) throw new Error(json.error?.message || 'Request failed');
    return json.data;
  }, [fallbackAuthToken, fallbackServerUrl, selectedBackendId]);

  return useMemo(() => ({
    get: (path: string) => request(path),
    post: (path: string, body?: unknown) => request(path, 'POST', body),
    patch: (path: string, body?: unknown) => request(path, 'PATCH', body),
    del: (path: string) => request(path, 'DELETE'),
  }), [request]);
}

export type AutomationApiType = ReturnType<typeof useAutomationApi>;
