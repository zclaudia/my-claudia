/**
 * Agent tool definitions and execution for the client-side Meta-Agent.
 *
 * Tools are registered with the centralized ToolRegistry, enabling both
 * built-in and plugin-provided tools to be available to the agent.
 * Multi-backend support: optional backendId routes to the correct backend.
 */

import type { ToolDefinition, ToolCall } from './clientAI';
import * as api from './api';
import { useChatStore } from '../stores/chatStore';
import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { resolveGatewayBackendUrl, getGatewayAuthHeaders } from './gatewayProxy';
import { toolRegistry, type ToolExecutionContext } from './toolRegistry';

// Re-export types for backward compatibility
export type { ToolExecutionContext } from './toolRegistry';

// ============================================
// Multi-backend routing
// ============================================

function isActiveBackend(backendId?: string): boolean {
  if (!backendId) return true;
  const activeId = useServerStore.getState().activeServerId;
  if (backendId === 'local' && activeId && !activeId.startsWith('gw:')) return true;
  if (backendId === activeId) return true;
  return false;
}

function resolveBackend(backendId: string): { baseUrl: string; headers: Record<string, string> } {
  const gwState = useGatewayStore.getState();

  if (backendId === 'local') {
    if (gwState.hasDirectConfig()) {
      const firstId = findFirstBackendId(gwState);
      if (!firstId) throw new Error('No online backend found');
      const url = resolveGatewayBackendUrl(firstId);
      if (!url) throw new Error('Cannot resolve backend URL');
      return { baseUrl: url, headers: getGatewayAuthHeaders() as Record<string, string> };
    }
    const { servers } = useServerStore.getState();
    const localServer = servers.find(s => !s.id.startsWith('gw:'));
    if (!localServer) throw new Error('No local server found');
    const address = localServer.address.includes('://') ? localServer.address : `http://${localServer.address}`;
    return { baseUrl: address, headers: {} };
  }

  const url = resolveGatewayBackendUrl(backendId);
  if (!url) throw new Error(`Cannot resolve backend: ${backendId}`);
  return { baseUrl: url, headers: getGatewayAuthHeaders() as Record<string, string> };
}

function findFirstBackendId(gwState: { discoveredBackends: Array<{ backendId: string; online: boolean; isLocal?: boolean }> }): string | null {
  const local = gwState.discoveredBackends.find(b => b.isLocal && b.online);
  if (local) return local.backendId;
  const first = gwState.discoveredBackends.find(b => b.online);
  return first?.backendId ?? null;
}

async function executeWithBackend<T extends { backendId?: string }>(
  args: T,
  handler: (args: T, remote?: { baseUrl: string; headers: Record<string, string> }) => Promise<string>,
): Promise<string> {
  if (isActiveBackend(args.backendId)) {
    return handler(args);
  }
  const remote = resolveBackend(args.backendId!);
  return handler(args, remote);
}

async function remoteFetch<T>(remote: { baseUrl: string; headers: Record<string, string> }, path: string, options?: RequestInit): Promise<T> {
  const url = `${remote.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...remote.headers, ...options?.headers },
  });
  const json = await response.json();
  if (json.success === false) throw new Error(json.error?.message || 'API error');
  return json.data;
}

// ============================================
// Tool Implementations
// ============================================

function executeListBackends(): string {
  const gwState = useGatewayStore.getState();
  const { servers } = useServerStore.getState();
  const isMobileMode = gwState.hasDirectConfig();

  const backends: Array<{ id: string; name: string; online: boolean; isLocal: boolean }> = [];

  if (!isMobileMode) {
    for (const server of servers) {
      if (server.id.startsWith('gw:')) continue;
      backends.push({ id: 'local', name: server.name || 'Local Backend', online: true, isLocal: true });
    }
  }

  for (const backend of gwState.discoveredBackends) {
    if (!isMobileMode && backend.isLocal) continue;
    if (!backend.online) continue;
    backends.push({ id: backend.backendId, name: backend.name || backend.backendId, online: true, isLocal: false });
  }

  return JSON.stringify({ backends }, null, 2);
}

async function toolListProjects(
  _args: { backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  const projects = remote
    ? await remoteFetch<any[]>(remote, '/api/projects')
    : await api.getProjects();
  const summary = projects.map(p => ({
    id: p.id, name: p.name, type: p.type, rootPath: p.rootPath,
  }));
  return JSON.stringify(summary, null, 2);
}

async function toolListSessions(
  args: { projectId?: string; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  const path = args.projectId ? `/api/sessions?projectId=${encodeURIComponent(args.projectId)}` : '/api/sessions';
  const sessions = remote
    ? await remoteFetch<any[]>(remote, path)
    : await api.getSessions(args.projectId);
  const summary = sessions.map(s => ({
    id: s.id, name: s.name, projectId: s.projectId, updatedAt: s.updatedAt, type: s.type,
  }));
  return JSON.stringify(summary, null, 2);
}

async function toolGetSessionMessages(
  args: { sessionId: string; limit?: number; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  const limit = args.limit || 20;
  if (remote) {
    const data = await remoteFetch<any>(remote, `/api/sessions/${args.sessionId}/messages?limit=${limit}`);
    const msgs = (data.messages || data || []).map((m: any) => ({
      role: m.role, content: m.content?.slice(0, 500), createdAt: m.createdAt,
    }));
    return JSON.stringify(msgs, null, 2);
  }
  const result = await api.getSessionMessages(args.sessionId, { limit });
  const msgs = result.messages.map(m => ({
    role: m.role, content: m.content?.slice(0, 500), createdAt: m.createdAt,
  }));
  return JSON.stringify(msgs, null, 2);
}

async function toolSearchMessages(
  args: { query: string; projectId?: string; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  if (remote) {
    let path = `/api/sessions/search/messages?q=${encodeURIComponent(args.query)}`;
    if (args.projectId) path += `&projectId=${encodeURIComponent(args.projectId)}`;
    const results = await remoteFetch<any[]>(remote, path);
    return JSON.stringify(results?.slice(0, 20), null, 2);
  }
  const results = await api.searchMessages(args.query, { projectId: args.projectId });
  return JSON.stringify(results?.slice(0, 20), null, 2);
}

async function toolSummarizeSession(
  args: { sessionId: string; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  if (remote) {
    const data = await remoteFetch<any>(remote, `/api/sessions/${args.sessionId}/export`);
    const md = data.markdown || data;
    return typeof md === 'string' ? md.slice(0, 8000) : JSON.stringify(md).slice(0, 8000);
  }
  const result = await api.exportSession(args.sessionId);
  return result.markdown.slice(0, 8000);
}

async function toolCreateSession(
  args: { projectId: string; name: string; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  if (remote) {
    const session = await remoteFetch<any>(remote, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId: args.projectId, name: args.name }),
    });
    return JSON.stringify({ id: session.id, name: session.name, projectId: session.projectId }, null, 2);
  }
  const session = await api.createSession({ projectId: args.projectId, name: args.name });
  return JSON.stringify({ id: session.id, name: session.name, projectId: session.projectId }, null, 2);
}

async function toolDeleteSession(
  args: { sessionId: string; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  if (remote) {
    await remoteFetch<any>(remote, `/api/sessions/${args.sessionId}`, { method: 'DELETE' });
    return JSON.stringify({ success: true, deleted: args.sessionId });
  }
  await api.deleteSession(args.sessionId);
  return JSON.stringify({ success: true, deleted: args.sessionId });
}

async function toolListProviders(
  _args: { backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  const providers = remote
    ? await remoteFetch<any[]>(remote, '/api/providers')
    : await api.getProviders();
  const summary = providers.map(p => ({
    id: p.id, name: p.name, type: p.type, isDefault: p.isDefault,
  }));
  return JSON.stringify(summary, null, 2);
}

async function toolListFiles(
  args: { projectRoot: string; relativePath?: string; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  const params = new URLSearchParams({ projectRoot: args.projectRoot });
  if (args.relativePath) params.set('relativePath', args.relativePath);

  if (remote) {
    const data = await remoteFetch<any>(remote, `/api/files/list?${params.toString()}`);
    return JSON.stringify(data, null, 2);
  }
  const result = await api.listDirectory({ projectRoot: args.projectRoot, relativePath: args.relativePath });
  return JSON.stringify(result, null, 2);
}

async function toolReadFile(
  args: { projectRoot: string; relativePath: string; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  if (remote) {
    const params = new URLSearchParams({ projectRoot: args.projectRoot, relativePath: args.relativePath });
    const data = await remoteFetch<any>(remote, `/api/files/content?${params.toString()}`);
    const content = typeof data === 'string' ? data : (data.content || JSON.stringify(data));
    return content.slice(0, 10000);
  }
  const result = await api.getFileContent({ projectRoot: args.projectRoot, relativePath: args.relativePath });
  const content = typeof result === 'string' ? result : ((result as any).content || JSON.stringify(result));
  return content.slice(0, 10000);
}

async function toolArchiveSessions(
  args: { sessionIds: string[]; backendId?: string },
  remote?: { baseUrl: string; headers: Record<string, string> },
): Promise<string> {
  if (remote) {
    await remoteFetch<any>(remote, '/api/sessions/archive', {
      method: 'POST',
      body: JSON.stringify({ sessionIds: args.sessionIds }),
    });
    return JSON.stringify({ success: true, archived: args.sessionIds.length });
  }
  await api.archiveSessions(args.sessionIds);
  return JSON.stringify({ success: true, archived: args.sessionIds.length });
}

function toolSendTaskToSession(
  args: { sessionId: string; input: string },
  context?: ToolExecutionContext,
): string {
  if (!context?.sendWsMessage) {
    return JSON.stringify({ error: 'No WebSocket connection available. Cannot send tasks to sessions.' });
  }
  if (!context.isConnected) {
    return JSON.stringify({ error: 'Not connected to backend. Cannot send tasks.' });
  }

  const clientRequestId = `meta_${crypto.randomUUID()}`;
  context.sendWsMessage({
    type: 'run_start',
    clientRequestId,
    sessionId: args.sessionId,
    input: args.input,
  });

  return JSON.stringify({
    success: true,
    message: `Task sent to session ${args.sessionId}`,
    clientRequestId,
  });
}

function toolGetSessionStatus(
  args: { sessionId: string },
): string {
  const chatState = useChatStore.getState();
  const { activeRuns } = chatState;

  let activeRunId: string | null = null;
  for (const [runId, sid] of Object.entries(activeRuns)) {
    if (sid === args.sessionId) {
      activeRunId = runId;
      break;
    }
  }

  const sessionMessages = chatState.messages[args.sessionId] || [];
  const recentMessages = sessionMessages.slice(-5).map(m => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content.slice(0, 200) : '',
    createdAt: m.createdAt,
  }));

  return JSON.stringify({
    sessionId: args.sessionId,
    hasActiveRun: !!activeRunId,
    activeRunId,
    totalMessages: sessionMessages.length,
    recentMessages,
  }, null, 2);
}

// ============================================
// Register built-in tools with ToolRegistry
// ============================================

interface BuiltinToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: any, context?: ToolExecutionContext) => Promise<string> | string;
}

const BUILTIN_TOOLS: BuiltinToolDef[] = [
  {
    name: 'list_backends',
    description: 'List all connected backends with their names, IDs, and online status.',
    parameters: { type: 'object', properties: {} },
    handler: () => executeListBackends(),
  },
  {
    name: 'list_projects',
    description: 'List all projects on a backend.',
    parameters: { type: 'object', properties: { backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } } },
    handler: (args) => executeWithBackend(args, toolListProjects),
  },
  {
    name: 'list_sessions',
    description: 'List sessions, optionally filtered by project.',
    parameters: { type: 'object', properties: { projectId: { type: 'string', description: 'Filter by project ID.' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } } },
    handler: (args) => executeWithBackend(args, toolListSessions),
  },
  {
    name: 'get_session_messages',
    description: 'Get recent messages from a session.',
    parameters: { type: 'object', properties: { sessionId: { type: 'string', description: 'Session ID to get messages from.' }, limit: { type: 'number', description: 'Max messages to return (default 20).' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } }, required: ['sessionId'] },
    handler: (args) => executeWithBackend(args, toolGetSessionMessages),
  },
  {
    name: 'search_messages',
    description: 'Search across all session messages by keyword.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword.' }, projectId: { type: 'string', description: 'Optionally limit search to a project.' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } }, required: ['query'] },
    handler: (args) => executeWithBackend(args, toolSearchMessages),
  },
  {
    name: 'summarize_session',
    description: 'Export a session as markdown for analysis and summarization.',
    parameters: { type: 'object', properties: { sessionId: { type: 'string', description: 'Session ID to export.' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } }, required: ['sessionId'] },
    handler: (args) => executeWithBackend(args, toolSummarizeSession),
  },
  {
    name: 'create_session',
    description: 'Create a new session in a project.',
    parameters: { type: 'object', properties: { projectId: { type: 'string', description: 'Project ID to create session in.' }, name: { type: 'string', description: 'Session name.' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } }, required: ['projectId', 'name'] },
    handler: (args) => executeWithBackend(args, toolCreateSession),
  },
  {
    name: 'delete_session',
    description: 'Delete a session. Ask the user for confirmation before calling this.',
    parameters: { type: 'object', properties: { sessionId: { type: 'string', description: 'Session ID to delete.' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } }, required: ['sessionId'] },
    handler: (args) => executeWithBackend(args, toolDeleteSession),
  },
  {
    name: 'list_providers',
    description: 'List available AI providers (Claude, OpenCode, etc.).',
    parameters: { type: 'object', properties: { backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } } },
    handler: (args) => executeWithBackend(args, toolListProviders),
  },
  {
    name: 'list_files',
    description: 'List files in a project directory.',
    parameters: { type: 'object', properties: { projectRoot: { type: 'string', description: 'Absolute path to project root.' }, relativePath: { type: 'string', description: 'Relative path within project (default: root).' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } }, required: ['projectRoot'] },
    handler: (args) => executeWithBackend(args, toolListFiles),
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in a project.',
    parameters: { type: 'object', properties: { projectRoot: { type: 'string', description: 'Absolute path to project root.' }, relativePath: { type: 'string', description: 'Relative path to file.' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } }, required: ['projectRoot', 'relativePath'] },
    handler: (args) => executeWithBackend(args, toolReadFile),
  },
  {
    name: 'archive_sessions',
    description: 'Archive multiple sessions to clean up. Ask the user for confirmation first.',
    parameters: { type: 'object', properties: { sessionIds: { type: 'array', items: { type: 'string' }, description: 'Session IDs to archive.' }, backendId: { type: 'string', description: 'Backend ID. Omit for active backend.' } }, required: ['sessionIds'] },
    handler: (args) => executeWithBackend(args, toolArchiveSessions),
  },
  {
    name: 'send_task_to_session',
    description: 'Send a task/message to a coding session to start a new AI run. Requires an active WebSocket connection to the backend.',
    parameters: { type: 'object', properties: { sessionId: { type: 'string', description: 'The session ID to send the task to.' }, input: { type: 'string', description: 'The message/task to send to the session.' } }, required: ['sessionId', 'input'] },
    handler: (args, context) => toolSendTaskToSession(args, context),
  },
  {
    name: 'get_session_status',
    description: 'Check if a session has an active AI run and get its recent activity summary.',
    parameters: { type: 'object', properties: { sessionId: { type: 'string', description: 'The session ID to check.' } }, required: ['sessionId'] },
    handler: (args) => toolGetSessionStatus(args),
  },
];

// Register all built-in tools at module load
for (const tool of BUILTIN_TOOLS) {
  toolRegistry.register({
    id: tool.name,
    definition: {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    },
    handler: tool.handler,
    source: 'builtin',
  });
}

// ============================================
// Public API
// ============================================

/**
 * Get all agent tool definitions (built-in + plugin-provided).
 * Replaces the static AGENT_TOOLS array.
 */
export function getAgentTools(): ToolDefinition[] {
  return toolRegistry.getAllDefinitions();
}

/**
 * @deprecated Use getAgentTools() instead. This static array does not include plugin tools.
 */
export const AGENT_TOOLS: ToolDefinition[] = toolRegistry.getDefinitionsBySource('builtin');

/**
 * Execute a tool call and return the result as a string.
 * Delegates to the centralized ToolRegistry.
 */
export async function executeToolCall(toolCall: ToolCall, context?: ToolExecutionContext): Promise<string> {
  return toolRegistry.execute(toolCall, context);
}
