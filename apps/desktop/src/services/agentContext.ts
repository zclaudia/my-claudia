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
  const { discoveredBackends, gatewayUrl, localBackendId } = gwState;
  const { servers } = useServerStore.getState();

  // Mobile mode: direct gateway config means no local server is reachable
  const isMobileMode = gwState.hasDirectConfig();

  const sections: string[] = [];
  sections.push('## Connected Backends\n');

  // Determine gateway HTTP base URL (for remote backends)
  let gatewayHttpBase = '';
  if (gatewayUrl) {
    gatewayHttpBase = gatewayUrl.includes('://')
      ? gatewayUrl.replace(/^ws/, 'http')
      : `http://${gatewayUrl}`;
  }

  // Local backend (direct server, not via gateway)
  // Skip on mobile — localhost is not reachable from the phone
  if (!isMobileMode) {
    const localServers = servers.filter(s => !s.id.startsWith('gw:'));
    for (const server of localServers) {
      const address = server.address.includes('://')
        ? server.address
        : `http://${server.address}`;
      const isLocal = localBackendId && discoveredBackends.some(
        b => b.backendId === localBackendId && b.isLocal
      );
      sections.push(
        `### ${server.name || 'Local Backend'}${isLocal ? ' (local, this server)' : ''}\n` +
        `- API Base: \`${address}\`\n` +
        `- Example: \`curl -s ${address}/api/projects | jq .\`\n`
      );
    }
  }

  // Gateway-discovered backends
  for (const backend of discoveredBackends) {
    // On desktop, skip local backend (already listed above as direct server)
    // On mobile, include ALL online backends (no local duplicate to worry about)
    if (!isMobileMode && backend.isLocal) continue;
    if (!backend.online) continue;

    const apiBase = `${gatewayHttpBase}/api/proxy/${backend.backendId}`;
    sections.push(
      `### ${backend.name || backend.backendId}\n` +
      `- Backend ID: \`${backend.backendId}\`\n` +
      `- API Base: \`${apiBase}\`\n` +
      `- Example: \`curl -s ${apiBase}/api/projects | jq .\`\n`
    );
  }

  // Auth info for gateway proxied requests
  const hasGatewayBackends = discoveredBackends.some(b =>
    b.online && (isMobileMode || !b.isLocal)
  );
  if (gatewayHttpBase && hasGatewayBackends) {
    const { gatewaySecret } = useGatewayStore.getState();
    if (gatewaySecret) {
      sections.push(
        `### Authentication\n` +
        `For remote backends (via gateway proxy), include the auth header:\n` +
        `\`curl -s -H "Authorization: Bearer ${gatewaySecret}" <API_BASE>/api/...\`\n`
      );
    }
  }

  return sections.join('\n');
}
