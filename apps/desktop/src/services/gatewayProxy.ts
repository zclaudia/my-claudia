/**
 * Gateway Proxy URL Resolution — Single source of truth
 *
 * All gateway backend URL construction MUST go through these functions.
 * This ensures desktop traffic is always routed through the local backend
 * proxy (which supports SOCKS5), while mobile falls back to direct gateway.
 *
 * Desktop: http://127.0.0.1:{localPort}/api/gateway-proxy/{backendId}/...
 * Mobile:  {gatewayUrl}/api/proxy/{backendId}/...
 */

import { useServerStore } from '../stores/serverStore';
import { useGatewayStore } from '../stores/gatewayStore';

/**
 * Resolve a gateway backend ID to its HTTP base URL.
 *
 * Desktop (localServerPort exists): routes through local backend proxy.
 * Mobile (no localServerPort): routes directly to gateway.
 */
export function resolveGatewayBackendUrl(backendId: string): string | null {
  // Desktop: route through local backend proxy (supports SOCKS5)
  const localPort = useServerStore.getState().localServerPort;
  if (localPort) {
    return `http://127.0.0.1:${localPort}/api/gateway-proxy/${backendId}`;
  }

  // Mobile fallback: direct connection to gateway
  const { gatewayUrl } = useGatewayStore.getState();
  if (!gatewayUrl) return null;
  const gwAddr = gatewayUrl.includes('://')
    ? gatewayUrl.replace(/^ws/, 'http')
    : `http://${gatewayUrl}`;
  return `${gwAddr}/api/proxy/${backendId}`;
}

/**
 * Get auth headers for requests to a gateway backend.
 *
 * Desktop: local proxy injects auth automatically, returns empty.
 * Mobile: returns Bearer token from gateway secret.
 */
export function getGatewayAuthHeaders(): Record<string, string> {
  // Desktop: local proxy handles gateway auth
  const localPort = useServerStore.getState().localServerPort;
  if (localPort) return {};

  // Mobile: need Bearer token for direct gateway connection
  const { gatewaySecret } = useGatewayStore.getState();
  if (!gatewaySecret) return {};
  return { Authorization: `Bearer ${gatewaySecret}` };
}

