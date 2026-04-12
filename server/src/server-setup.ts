/**
 * Server HTTP route mounting and service initialization.
 *
 * This file is the primary Express/REST API assembly point.
 * It is intentionally separate from `server/src/router`, which is the WebSocket
 * message router used for shared-protocol request.type dispatch.
 */
import type { Express, Request, Response } from 'express';
import type { WebSocket } from 'ws';
import type { initDatabase } from './infrastructure/storage/db.js';
import type { GatewayConfig, GatewayStatus } from './interfaces/http/gateway.js';
import { ProcessSupervisor, setGlobalProcessSupervisor } from './infrastructure/services/process-supervisor.js';
import type { NotificationService } from './domains/notification-feed/index.js';
import type { SupervisorService } from './domains/supervision/index.js';
import { PushNotificationService } from './infrastructure/push/push-notification-service.js';
import { ALL_SERVER_FEATURES } from '@my-claudia/shared/core/server';
import { isLocalhost } from './interfaces/http/middleware/local-only.js';
import { createExpressAuthMiddleware } from './interfaces/http/middleware/express-auth.js';
import { getPublicKeyPem } from './utils/crypto.js';
import { getSdkVersionReport } from './utils/sdk-version-check.js';
import { ProcessMonitor } from './utils/process-monitor.js';
import { sendMessage } from './application/conversation/transport/broadcast.js';
import type { ConnectedClient, ActiveRun } from './application/conversation/transport/types.js';
import type { createRouter } from './interfaces/websocket/index.js';
import { createGatewayState } from './infrastructure/gateway/gateway-state.js';
import { bootstrapDomains } from './application/domain-bootstrap.js';

export interface SetupDependencies {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  router: ReturnType<typeof createRouter>;
  clients: Map<string, ConnectedClient>;
  activeRuns: Map<string, ActiveRun>;
  buildStateHeartbeat: () => import('@my-claudia/shared/protocol/messages').StateHeartbeatMessage;
  broadcastHeartbeat: () => void;
  broadcastPluginState: () => void;
  handleRunStart: (...args: any[]) => Promise<void>;
  getServerPort: () => number | null;
  setNotificationService: (ns: PushNotificationService) => void;
  setProcessMonitor: (pm: ProcessMonitor) => void;
}

export interface SetupResult {
  gatewayStatus: GatewayStatus;
  getGatewayStatus: () => GatewayStatus;
  connectGateway: (config: GatewayConfig) => Promise<void>;
  disconnectGateway: () => Promise<void>;
  updateGatewayConnected: (connected: boolean) => void;
  updateGatewayBackendId: (backendId: string | null) => void;
  updateGatewayIdentity: (instanceId: string, deviceId: string) => void;
  updateDiscoveredBackends: (backends: import('@my-claudia/shared/core/server').GatewayBackendInfo[]) => void;
  setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => void;
  setGatewayDisconnector: (disconnector: () => Promise<void>) => void;
  notificationService: PushNotificationService;
  supervisorService: SupervisorService;
  notificationsService: NotificationService;
  orchestrator: import('./application/orchestration/types.js').TaskOrchestrator;
  permissionBridge?: import('./application/conversation/agent/permission-bridge.js').PermissionBridge;
  cancelWorkflowRun?: (runId: string) => void;
  /** Cleanup function: call when WebSocket server closes */
  onWssClose: () => void;
}

export function setupRoutesAndServices(deps: SetupDependencies): SetupResult {
  const {
    db, app, router, clients, activeRuns,
    buildStateHeartbeat, broadcastHeartbeat, broadcastPluginState,
    handleRunStart, getServerPort,
    setNotificationService, setProcessMonitor,
  } = deps;

  // Process supervisor
  const processSupervisor = new ProcessSupervisor(db);
  setGlobalProcessSupervisor(processSupervisor);
  processSupervisor.start();

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Get server info (public - no auth required)
  app.get('/api/server/info', async (req: Request, res: Response) => {
    const isLocal = isLocalhost(req);
    const publicKey = getPublicKeyPem();
    const sdkVersions = getSdkVersionReport();
    res.json({
      success: true,
      data: {
        version: '1.1.0',
        isLocalConnection: isLocal,
        features: ALL_SERVER_FEATURES,
        ...(publicKey && { publicKey }),
        ...(sdkVersions && { sdkVersions }),
      }
    });
  });

  // Auth middleware
  const authMiddleware = createExpressAuthMiddleware((token) => {
    const row = db.prepare(`
      SELECT client_id
      FROM servers
      WHERE client_id = ?
      LIMIT 1
    `).get(token) as { client_id: string } | undefined;

    return !!row?.client_id;
  });

  // Gateway state
  const gateway = createGatewayState({ db });

  // Domain registration, route mounting, orchestration wiring
  const {
    supervisorService,
    notificationsService,
    pushNotificationService,
    orchestrator,
    permissionBridge: permBridge,
    cancelWorkflowRun: cancelWfRun,
  } = bootstrapDomains({
    db, app, authMiddleware, clients, activeRuns,
    broadcastPluginState, broadcastHeartbeat,
    handleRunStart, getServerPort,
    setNotificationService, processSupervisor,
    gateway,
  });

  // Periodic state heartbeat broadcast (every 30s)
  const heartbeatInterval = setInterval(() => {
    const heartbeat = buildStateHeartbeat();
    clients.forEach((client) => {
      if (client.authenticated) {
        sendMessage(client.ws, heartbeat);
      }
    });
  }, 30000);

  // Process leak monitor
  const processMonitor = new ProcessMonitor(
    () => activeRuns.size,
    (report) => {
      const pids = report.leakedProcesses.map(p => `PID=${p.pid}(${p.command}, ${p.elapsedSeconds}s)`).join(', ');
      console.warn(`[ProcessMonitor] Leaked processes detected (activeRuns=${report.activeRunCount}): ${pids}`);
      pushNotificationService.notify({
        type: 'process_leak',
        title: 'Leaked processes detected',
        body: `${report.leakedProcesses.length} orphaned process(es) found: ${pids}`,
        priority: 'high',
        tags: ['warning'],
      });
    },
    {
      autoKill: false,
      minElapsedSeconds: 120,
      ignoreCommands: ['opencode', 'mcp-bridge', 'mcp-server'],
    },
  );
  processMonitor.start();
  setProcessMonitor(processMonitor);

  const onWssClose = () => {
    clearInterval(heartbeatInterval);
    processMonitor.stop();
    setGlobalProcessSupervisor(null);
    processSupervisor.stop();
    supervisorService.stop();
  };

  return {
    gatewayStatus: gateway.gatewayStatus,
    getGatewayStatus: gateway.getGatewayStatus,
    connectGateway: gateway.connectGateway,
    disconnectGateway: gateway.disconnectGateway,
    updateGatewayConnected: gateway.updateGatewayConnected,
    updateGatewayBackendId: gateway.updateGatewayBackendId,
    updateGatewayIdentity: gateway.updateGatewayIdentity,
    updateDiscoveredBackends: gateway.updateDiscoveredBackends,
    setGatewayConnector: gateway.setGatewayConnector,
    setGatewayDisconnector: gateway.setGatewayDisconnector,
    notificationService: pushNotificationService,
    supervisorService,
    notificationsService,
    orchestrator,
    permissionBridge: permBridge,
    cancelWorkflowRun: cancelWfRun,
    onWssClose,
  };
}
