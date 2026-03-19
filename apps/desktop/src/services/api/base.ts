import type { ApiResponse, ServerFeature } from '@my-claudia/shared';
import { useServerStore } from '../../stores/serverStore';
import { isGatewayTarget, parseBackendId } from '../../stores/gatewayStore';
import { resolveGatewayBackendUrl, getGatewayAuthHeaders } from '../gatewayProxy';

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

export function getBaseUrl(): string {
  const activeId = useServerStore.getState().activeServerId;

  // Gateway target: delegate to shared gateway proxy resolver
  if (isGatewayTarget(activeId)) {
    const backendId = parseBackendId(activeId!);
    const url = resolveGatewayBackendUrl(backendId);
    if (!url) throw new Error('Gateway not configured');
    return url;
  }

  // Direct server: connect directly to backend
  const server = useServerStore.getState().getActiveServer();
  if (!server) {
    throw new Error('No server configured');
  }
  const address = server.address.includes('://')
    ? server.address
    : `http://${server.address}`;
  return address;
}

// Get authentication header for the active server
export function getAuthHeaders(): HeadersInit {
  const activeId = useServerStore.getState().activeServerId;

  // Gateway target: delegate to shared gateway auth resolver
  if (isGatewayTarget(activeId)) {
    return getGatewayAuthHeaders();
  }

  // Direct server: no auth needed (server trusts localhost connections)
  return {};
}

export async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
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
  const server = useServerStore.getState().getDefaultServer();
  const address = server?.address || 'localhost:3100';
  return address.includes('://') ? address : `http://${address}`;
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
