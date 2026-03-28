import type { ApiResponse, ServerFeature } from '@my-claudia/shared';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';

import { resolveGatewayBackendUrl, getGatewayAuthHeaders } from '../gatewayProxy';
import { getControlPlaneMode, isLocalBackendId } from '../../utils/controlPlane';

/** Check if the active server advertises a specific feature. */
export function activeServerSupports(feature: ServerFeature): boolean {
  return useServerStore.getState().activeServerSupports(feature);
}

// Custom error class for authentication errors
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function getBaseUrlForBackend(backendId?: string | null): string {
  const activeId = backendId ?? useServerStore.getState().activeServerId;
  const controlPlaneMode = getControlPlaneMode();
  const localPort = useServerStore.getState().localServerPort;

  if (controlPlaneMode === 'embedded-local') {
    if (!localPort) throw new Error('No server configured');

    // Known local backend → direct connection
    if (!activeId || isLocalBackendId(activeId)) {
      return `http://localhost:${localPort}`;
    }

    // Check if this backend is explicitly registered as remote in facadeStore.
    // During early initialization, facadeStore.localBackendId may not be set yet,
    // causing isLocalBackendId() to return false for the local backend.
    // Only route through gateway-proxy when we're sure it's a remote backend.
    const backend = useFacadeStore.getState().backends.find(b => b.backendId === activeId);
    const isConfirmedRemote = backend && !backend.isThisInstance && backend.channel !== 'local';
    if (isConfirmedRemote) {
      return resolveGatewayBackendUrl(activeId) || `http://localhost:${localPort}`;
    }

    // Unresolved or unconfirmed → fallback to direct local connection
    return `http://localhost:${localPort}`;
  }

  // Gateway-direct mode: delegate to shared gateway proxy resolver
  if (activeId) {
    const url = resolveGatewayBackendUrl(activeId);
    if (!url) throw new Error('Gateway not configured');
    return url;
  }

  // Direct/local server: connect via localhost
  if (!localPort) {
    throw new Error('No server configured');
  }
  return `http://localhost:${localPort}`;
}

export function getBaseUrl(): string {
  return getBaseUrlForBackend();
}

// Get authentication header for the active server
export function getAuthHeadersForBackend(backendId?: string | null): HeadersInit {
  const activeId = backendId ?? useServerStore.getState().activeServerId;
  const controlPlaneMode = getControlPlaneMode();

  if (controlPlaneMode === 'embedded-local') {
    if (!activeId || isLocalBackendId(activeId)) return {};

    // Only add gateway auth for confirmed remote backends (same logic as getBaseUrlForBackend)
    const backend = useFacadeStore.getState().backends.find(b => b.backendId === activeId);
    const isConfirmedRemote = backend && !backend.isThisInstance && backend.channel !== 'local';
    if (isConfirmedRemote) return getGatewayAuthHeaders();

    return {};
  }

  // Gateway-direct mode
  if (activeId) {
    return getGatewayAuthHeaders();
  }

  // Direct server: no auth needed (server trusts localhost connections)
  return {};
}

export function getAuthHeaders(): HeadersInit {
  return getAuthHeadersForBackend();
}

export async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  return fetchApiForBackend<T>(path, undefined, options);
}

export async function fetchApiForBackend<T>(
  path: string,
  backendId?: string | null,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const baseUrl = getBaseUrlForBackend(backendId);
  const authHeaders = getAuthHeadersForBackend(backendId);
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options?.headers
    }
  });

  // Handle authentication errors
  if (response.status === 401) {
    throw new AuthError('Authentication required');
  }
  if (response.status === 403) {
    throw new AuthError('Access forbidden');
  }

  return response.json();
}

// ============================================
// Local API: always targets the local server
// Used by Settings, data loader, and admin features
// ============================================

function getLocalBaseUrl(): string {
  const port = useServerStore.getState().localServerPort || 3100;
  return `http://localhost:${port}`;
}

function getLocalAuthHeaders(): HeadersInit {
  // Local server trusts localhost connections, no auth needed
  return {};
}

export async function fetchLocalApi<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const baseUrl = getLocalBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getLocalAuthHeaders(),
      ...options?.headers
    }
  });

  if (response.status === 401) {
    throw new AuthError('Authentication required');
  }
  if (response.status === 403) {
    throw new AuthError('Access forbidden');
  }

  return response.json();
}
