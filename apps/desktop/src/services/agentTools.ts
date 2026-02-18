/**
 * Agent tool definitions and execution for the client-side global agent.
 *
 * Tools are defined in OpenAI function calling format.
 * When the AI calls a tool, the executor routes it to the correct backend's REST API.
 */

import type { ToolDefinition, ToolCall } from './clientAI';
import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';

// ============================================
// Tool Definitions
// ============================================

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_backends',
      description: 'List all connected backends with their names, IDs, and online status.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_api',
      description: 'Call a REST API endpoint on a specific backend. Use this to manage projects, sessions, providers, supervisions, and files.',
      parameters: {
        type: 'object',
        properties: {
          backendId: {
            type: 'string',
            description: 'The backend ID to call. Use "local" for the local/default backend, or a specific gateway backend ID (e.g. "gw:abc123").',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE'],
            description: 'HTTP method.',
          },
          path: {
            type: 'string',
            description: 'API path (e.g. "/api/projects", "/api/sessions/abc123/messages?limit=50").',
          },
          body: {
            type: 'object',
            description: 'Request body for POST/PUT requests.',
          },
        },
        required: ['backendId', 'method', 'path'],
      },
    },
  },
];

// ============================================
// Tool Execution
// ============================================

/**
 * Execute a tool call and return the result as a string.
 */
export async function executeToolCall(toolCall: ToolCall): Promise<string> {
  try {
    const args = JSON.parse(toolCall.function.arguments);

    switch (toolCall.function.name) {
      case 'list_backends':
        return executeListBackends();

      case 'call_api':
        return await executeCallApi(args);

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
    }
  } catch (error) {
    return JSON.stringify({
      error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function executeListBackends(): string {
  const gwState = useGatewayStore.getState();
  const { discoveredBackends } = gwState;
  const { servers } = useServerStore.getState();

  // Mobile mode: direct gateway config means no local server is reachable
  const isMobileMode = gwState.hasDirectConfig();

  const backends: Array<{
    id: string;
    name: string;
    online: boolean;
    isLocal: boolean;
  }> = [];

  // Direct servers — skip on mobile (localhost not reachable from phone)
  if (!isMobileMode) {
    for (const server of servers) {
      if (server.id.startsWith('gw:')) continue;
      backends.push({
        id: 'local',
        name: server.name || 'Local Backend',
        online: true,
        isLocal: true,
      });
    }
  }

  // Gateway backends
  // On desktop: skip isLocal (already listed as direct server above)
  // On mobile: include ALL online backends (no local duplicate)
  for (const backend of discoveredBackends) {
    if (!isMobileMode && backend.isLocal) continue;
    if (!backend.online) continue;
    backends.push({
      id: backend.backendId,
      name: backend.name || backend.backendId,
      online: backend.online,
      isLocal: false,
    });
  }

  return JSON.stringify({ backends });
}

async function executeCallApi(args: {
  backendId: string;
  method: string;
  path: string;
  body?: unknown;
}): Promise<string> {
  const { backendId, method, path, body } = args;

  // Resolve the API base URL
  const baseUrl = resolveApiBaseUrl(backendId);
  if (!baseUrl) {
    return JSON.stringify({ error: `Backend not found: ${backendId}` });
  }

  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add gateway auth if the request is routed through the gateway
  const needsGatewayAuth = backendId !== 'local' || useGatewayStore.getState().hasDirectConfig();
  if (needsGatewayAuth) {
    const { gatewaySecret } = useGatewayStore.getState();
    if (gatewaySecret) {
      headers['Authorization'] = `Bearer ${gatewaySecret}`;
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    try {
      // Return parsed JSON for readability
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  } catch (error) {
    return JSON.stringify({
      error: `API call failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Resolve the API base URL for a given backend ID.
 */
function resolveApiBaseUrl(backendId: string): string | null {
  const gwState = useGatewayStore.getState();

  if (backendId === 'local') {
    // Mobile mode: route "local" through gateway to the first discovered backend
    if (gwState.hasDirectConfig()) {
      return resolveViaGateway(gwState, findFirstBackendId(gwState));
    }
    // Desktop: use direct server address
    const { servers } = useServerStore.getState();
    const localServer = servers.find(s => !s.id.startsWith('gw:'));
    if (!localServer) return null;
    return localServer.address.includes('://')
      ? localServer.address
      : `http://${localServer.address}`;
  }

  // Gateway backend
  return resolveViaGateway(gwState, backendId);
}

/** Find the first online backend ID from discovered backends */
function findFirstBackendId(gwState: { discoveredBackends: Array<{ backendId: string; online: boolean; isLocal?: boolean }> }): string | null {
  // Prefer isLocal backend (it's the one the user connected to)
  const local = gwState.discoveredBackends.find(b => b.isLocal && b.online);
  if (local) return local.backendId;
  // Fall back to first online backend
  const first = gwState.discoveredBackends.find(b => b.online);
  return first?.backendId ?? null;
}

/** Resolve a backend ID to its gateway proxy URL */
function resolveViaGateway(gwState: { gatewayUrl: string | null }, backendId: string | null): string | null {
  if (!backendId || !gwState.gatewayUrl) return null;
  const gwHttp = gwState.gatewayUrl.includes('://')
    ? gwState.gatewayUrl.replace(/^ws/, 'http')
    : `http://${gwState.gatewayUrl}`;
  return `${gwHttp}/api/proxy/${backendId}`;
}
