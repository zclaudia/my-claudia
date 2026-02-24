/**
 * Builds dynamic system context for the global agent.
 *
 * This context is prepended to the agent's system prompt via the
 * systemContext field in run_start. It provides the agent with
 * information about all connected backends and how to reach their APIs.
 */

import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';

/**
 * Build the dynamic context string describing available backends and their API routes.
 * Called before each agent run_start to inject current backend info.
 */
export function buildAgentContext(): string {
  const gwState = useGatewayStore.getState();
  const { discoveredBackends, gatewayUrl } = gwState;
  const { servers } = useServerStore.getState();

  // Mobile mode: direct gateway config means no local server is reachable
  const isMobileMode = gwState.hasDirectConfig();

  // Determine base URL for remote backends.
  // Desktop: route through local backend proxy (supports SOCKS5).
  // Mobile: direct connection to gateway.
  const localPort = useServerStore.getState().localServerPort;
  let gatewayHttpBase = '';
  if (localPort) {
    // Desktop: will use per-backend URL like http://127.0.0.1:{port}/api/gateway-proxy/{backendId}
    gatewayHttpBase = `http://127.0.0.1:${localPort}`;
  } else if (gatewayUrl) {
    gatewayHttpBase = gatewayUrl.includes('://')
      ? gatewayUrl.replace(/^ws/, 'http')
      : `http://${gatewayUrl}`;
  }

  // Collect all backends with their info
  interface BackendEntry {
    name: string;
    apiBase: string;
    isLocal: boolean;
    isRemote: boolean;
  }
  const allBackends: BackendEntry[] = [];

  // Local backend (direct server, not via gateway)
  // Skip on mobile — localhost is not reachable from the phone
  if (!isMobileMode) {
    const localServers = servers.filter(s => !s.id.startsWith('gw:'));
    for (const server of localServers) {
      const address = server.address.includes('://')
        ? server.address
        : `http://${server.address}`;
      allBackends.push({
        name: server.name || 'Local Backend',
        apiBase: address,
        isLocal: true,
        isRemote: false,
      });
    }
  }

  // Gateway-discovered backends
  for (const backend of discoveredBackends) {
    // On desktop, skip local backend (already listed above as direct server)
    // On mobile, include ALL online backends (no local duplicate to worry about)
    if (!isMobileMode && backend.isLocal) continue;
    if (!backend.online) continue;

    const apiBase = localPort
      ? `${gatewayHttpBase}/api/gateway-proxy/${backend.backendId}`
      : `${gatewayHttpBase}/api/proxy/${backend.backendId}`;
    allBackends.push({
      name: backend.name || backend.backendId,
      apiBase,
      isLocal: false,
      isRemote: true,
    });
  }

  // Build output
  const sections: string[] = [];
  sections.push(`## Connected Backends (${allBackends.length} total)\n`);

  for (const b of allBackends) {
    const tag = b.isLocal ? ' (local, this server)' : ' (remote, via gateway)';
    sections.push(
      `### ${b.name}${tag}\n` +
      `- API Base: \`${b.apiBase}\`\n` +
      `- Example: \`curl -s ${b.apiBase}/api/sessions | jq .data[].name\`\n`
    );
  }

  // Auth info for gateway proxied requests
  const hasGatewayBackends = allBackends.some(b => b.isRemote);
  if (hasGatewayBackends) {
    if (localPort) {
      // Desktop: local proxy handles auth automatically
      sections.push(
        `### Authentication\n` +
        `Remote backend requests are proxied through the local server. No auth header needed.\n`
      );
    } else if (gatewayHttpBase) {
      const { gatewaySecret } = useGatewayStore.getState();
      if (gatewaySecret) {
        sections.push(
          `### Authentication\n` +
          `For remote backends (via gateway proxy), include the auth header:\n` +
          `\`curl -s -H "Authorization: Bearer ${gatewaySecret}" <API_BASE>/api/...\`\n`
        );
      }
    }
  }

  if (allBackends.length === 0) {
    sections.push('No backends connected.\n');
  }

  return sections.join('\n');
}
