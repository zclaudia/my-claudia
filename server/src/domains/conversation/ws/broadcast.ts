import { WebSocket } from 'ws';
import type { ServerMessage, StateHeartbeatMessage, RunHealthStatus } from '@my-claudia/shared';
import { resolvePluginPlatform } from '@my-claudia/shared';
import { detectLoop } from '../../../loop-detection.js';
import { pluginLoader } from '../../../plugins/loader.js';
import { permissionManager as pluginPermissionManager } from '../../../plugins/permissions.js';
import { toolRegistry as pluginToolRegistry } from '../../../plugins/tool-registry.js';
import { commandRegistry as pluginCommandRegistry } from '../../../commands/registry.js';
import type { ConnectedClient, ActiveRun } from './types.js';

export function sendMessage(ws: WebSocket, message: ServerMessage): void {
  // Check readyState as number to support both real WebSocket and virtual clients
  // WebSocket.OPEN === 1, but virtual clients may have readyState typed differently
  if ((ws.readyState as number) === 1) {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error(`[WS] Failed to send message type=${message.type}:`, err);
    }
  }
}

export function broadcastToOtherAuthenticatedClients(
  clients: Map<string, ConnectedClient>,
  originClientId: string,
  message: ServerMessage,
): void {
  clients.forEach((client) => {
    if (!client.authenticated || client.id === originClientId) {
      return;
    }
    sendMessage(client.ws, message);
  });
}

export function buildStateHeartbeat(activeRuns: Map<string, ActiveRun>): StateHeartbeatMessage {
  const runs: StateHeartbeatMessage['activeRuns'] = [];
  const permissions: StateHeartbeatMessage['pendingPermissions'] = [];
  const questions: StateHeartbeatMessage['pendingQuestions'] = [];

  for (const [runId, run] of activeRuns) {
    if (run.completed) continue;
    const idleSec = (Date.now() - run.lastActivityAt) / 1000;
    const loop = detectLoop(run.recentToolCalls);
    if (loop.detected) {
      run.loopHeartbeatStreak += 1;
    } else {
      run.loopHeartbeatStreak = 0;
    }
    let health: RunHealthStatus = 'healthy';
    if (loop.detected && run.loopHeartbeatStreak >= 3) health = 'loop';
    else if (idleSec > 60) health = 'idle';
    runs.push({
      runId,
      sessionId: run.sessionId,
      startedAt: run.startedAt,
      lastActivityAt: run.lastActivityAt,
      health,
      loopPattern: (loop.detected && run.loopHeartbeatStreak >= 3) ? loop.pattern : undefined,
      sessionType: run.sessionType,
      systemInfo: run.latestSystemInfo,
      lastSeq: run.eventSeq || undefined,
    });
    for (const [requestId, pending] of run.pendingPermissions) {
      if (!pending.originalRequest) continue;
      if (pending.originalRequest.toolName === 'AskUserQuestion') {
        questions.push({
          requestId,
          sessionId: pending.originalRequest.sessionId || run.sessionId,
          questions: pending.originalRequest.questions || [],
        });
      } else {
        permissions.push({
          requestId,
          sessionId: pending.originalRequest.sessionId || run.sessionId,
          toolName: pending.originalRequest.toolName,
          detail: pending.originalRequest.detail,
          matchedRule: pending.originalRequest.matchedRule,
          timeoutSeconds: pending.originalRequest.timeoutSeconds,
          requiresCredential: pending.originalRequest.requiresCredential,
          credentialHint: pending.originalRequest.credentialHint,
          aiInitiated: pending.originalRequest.aiInitiated,
        } as StateHeartbeatMessage['pendingPermissions'][number]);
      }
    }
  }

  return { type: 'state_heartbeat', activeRuns: runs, pendingPermissions: permissions, pendingQuestions: questions };
}

/** Broadcast a state heartbeat to all authenticated clients immediately. */
export function broadcastHeartbeat(
  connectedClients: Map<string, ConnectedClient>,
  activeRuns: Map<string, ActiveRun>,
): void {
  const heartbeat = buildStateHeartbeat(activeRuns);
  connectedClients.forEach((client) => {
    if (client.authenticated) {
      sendMessage(client.ws, heartbeat);
    }
  });
}

/** Build a PluginStateMessage with current plugin states. */
export function buildPluginStateMessage(): import('@my-claudia/shared').PluginStateMessage {
  const plugins = pluginLoader.getPlugins().map(p => {
    const contributes = p.manifest.contributes || {};
    const panels = (contributes.panels || []).map((panel: { id: string; label: string; icon?: string; order?: number; frontend?: string }) => ({
      id: panel.id,
      label: panel.label,
      icon: panel.icon,
      order: panel.order,
      iframeUrl: panel.frontend
        ? `/api/plugins/${p.manifest.id}/frontend/${panel.frontend}`
        : undefined,
    }));
    return {
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      status: (p.isActive ? 'active' : p.error ? 'error' : 'inactive') as 'active' | 'inactive' | 'error',
      enabled: p.isActive,
      error: p.error,
      permissions: p.manifest.permissions || [],
      grantedPermissions: pluginPermissionManager.getGrantedPermissions(p.manifest.id),
      tools: pluginToolRegistry.getByPlugin(p.manifest.id).map(t => t.definition.function.name),
      commands: pluginCommandRegistry.getByPlugin(p.manifest.id).map(c => c.command),
      path: p.path,
      platform: resolvePluginPlatform(p.manifest),
      panels,
      requires: p.manifest.requires,
      capabilities: p.capabilities,
    };
  });
  return { type: 'plugin_state', plugins };
}

/** Broadcast plugin state to all authenticated clients. */
export function broadcastPluginState(connectedClients: Map<string, ConnectedClient>): void {
  const msg = buildPluginStateMessage();
  connectedClients.forEach((client) => {
    if (client.authenticated) {
      sendMessage(client.ws, msg);
    }
  });
}
