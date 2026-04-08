/**
 * Gateway connection state management.
 *
 * Encapsulates the mutable gateway status and connector/disconnector callbacks
 * that were previously closured inside setupRoutesAndServices().
 */
import type { GatewayConfig, GatewayStatus } from '../../interfaces/http/gateway.js';
import type { GatewayBackendInfo } from '@my-claudia/shared';

export interface GatewayState {
  gatewayStatus: GatewayStatus;
  getGatewayStatus: () => GatewayStatus;
  connectGateway: (config: GatewayConfig) => Promise<void>;
  disconnectGateway: () => Promise<void>;
  updateGatewayConnected: (connected: boolean) => void;
  updateGatewayBackendId: (backendId: string | null) => void;
  updateGatewayIdentity: (instanceId: string, deviceId: string) => void;
  updateDiscoveredBackends: (backends: GatewayBackendInfo[]) => void;
  setGatewayConnector: (connector: (config: GatewayConfig) => Promise<void>) => void;
  setGatewayDisconnector: (disconnector: () => Promise<void>) => void;
}

export interface GatewayStateDeps {
  db: import('better-sqlite3').Database;
}

export function createGatewayState({ db }: GatewayStateDeps): GatewayState {
  let gatewayStatus: GatewayStatus = {
    enabled: false,
    connected: false,
    gatewayBackendId: null,
    gatewayUrl: null,
    gatewaySecret: null,
    backendName: null,
    registerAsBackend: true,
    discoveredBackends: []
  };

  let gatewayConnector: ((config: GatewayConfig) => Promise<void>) = async () => {
    console.warn('[Gateway] Gateway connector not implemented');
  };
  let gatewayDisconnector: (() => Promise<void>) = async () => {
    console.warn('[Gateway] Gateway disconnector not implemented');
  };

  const getGatewayStatus = () => gatewayStatus;

  const connectGateway = async (config: GatewayConfig) => {
    gatewayStatus = {
      enabled: true,
      connected: false,
      gatewayBackendId: null,
      gatewayUrl: config.gatewayUrl,
      gatewaySecret: config.gatewaySecret,
      backendName: config.backendName,
      registerAsBackend: config.registerAsBackend !== false,
      discoveredBackends: []
    };
    await gatewayConnector(config);
  };

  const disconnectGateway = async () => {
    await gatewayDisconnector();
    gatewayStatus = {
      enabled: false,
      connected: false,
      gatewayBackendId: null,
      gatewayUrl: null,
      gatewaySecret: null,
      backendName: null,
      registerAsBackend: true,
      discoveredBackends: []
    };
  };

  const updateGatewayBackendId = (backendId: string | null) => {
    gatewayStatus.gatewayBackendId = backendId;
    if (backendId) {
      db.prepare(`
        UPDATE gateway_config SET backend_id = ?, updated_at = ? WHERE id = 1
      `).run(backendId, Date.now());
    }
  };

  const updateGatewayConnected = (connected: boolean) => {
    gatewayStatus.connected = connected;
  };

  const updateGatewayIdentity = (instanceId: string, deviceId: string) => {
    gatewayStatus.instanceId = instanceId;
    gatewayStatus.currentDeviceId = deviceId;
  };

  const updateDiscoveredBackends = (backends: GatewayBackendInfo[]) => {
    gatewayStatus.discoveredBackends = backends;
  };

  const setGatewayConnector = (connector: (config: GatewayConfig) => Promise<void>) => {
    gatewayConnector = connector;
  };

  const setGatewayDisconnector = (disconnector: () => Promise<void>) => {
    gatewayDisconnector = disconnector;
  };

  return {
    gatewayStatus,
    getGatewayStatus,
    connectGateway,
    disconnectGateway,
    updateGatewayConnected,
    updateGatewayBackendId,
    updateGatewayIdentity,
    updateDiscoveredBackends,
    setGatewayConnector,
    setGatewayDisconnector,
  };
}
