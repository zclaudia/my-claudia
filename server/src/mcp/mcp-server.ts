/**
 * Claudia MCP Server — exposes all registered tools via MCP protocol.
 *
 * Uses the low-level Server class (not McpServer) to avoid Zod dependency,
 * since our tool schemas are plain JSON Schema objects.
 *
 * Supports Streamable HTTP transport for external AI tool connections.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { toolRegistry } from '../domains/plugins/tool-registry.js';

const SERVER_NAME = 'claudia';
const SERVER_VERSION = '1.0.0';

interface McpSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
}

// Active MCP sessions keyed by session ID
const sessions = new Map<string, McpSession>();

function createServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  // tools/list — dynamically read from toolRegistry on each request
  server.setRequestHandler({ method: 'tools/list' } as any, async () => {
    const bridgeTools = toolRegistry.getBridgeTools();
    return {
      tools: bridgeTools.map(t => ({
        name: t.definition.function.name,
        description: t.definition.function.description || '',
        inputSchema: t.definition.function.parameters || { type: 'object', properties: {} },
      })),
    };
  });

  // tools/call — dispatch to toolRegistry.execute
  server.setRequestHandler({ method: 'tools/call' } as any, async (request: any) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await toolRegistry.execute(name, args || {}, {});
      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Handle an incoming MCP request (POST /mcp).
 * Creates or reuses a transport per session.
 */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // Reuse existing transport for this session
    const { transport } = sessions.get(sessionId)!;
    await transport.handleRequest(req, res, parsedBody);
    return;
  }

  // New session — create transport
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => `claudia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  const server = createServer();
  await server.connect(transport);

  // Store transport after connect (sessionId is now set)
  if (transport.sessionId) {
    sessions.set(transport.sessionId, { server, transport });
  }

  await transport.handleRequest(req, res, parsedBody);
}

/**
 * Handle GET /mcp (SSE stream for server-initiated messages).
 */
export async function handleMcpSse(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid session ID. Initialize first with POST /mcp.' }));
    return;
  }
  const { transport } = sessions.get(sessionId)!;
  await transport.handleRequest(req, res);
}

/**
 * Handle DELETE /mcp (session cleanup).
 */
export async function handleMcpSessionClose(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const { server } = sessions.get(sessionId)!;
    await server.close();
    sessions.delete(sessionId);
  }
  res.writeHead(200);
  res.end();
}

/**
 * Get MCP server info for /mcp/info endpoint.
 */
export function getMcpServerInfo(): Record<string, unknown> {
  const toolCount = toolRegistry.getBridgeTools().length;
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    tools: toolCount,
    transport: 'streamable-http',
    activeSessions: sessions.size,
  };
}
