/**
 * Global gateway client instance holder
 * This allows routes and other modules to access the gateway client
 * without circular dependencies
 */
import type { GatewayClient } from './gateway-client.js';
import type { GatewayClientMode } from './gateway-client-mode.js';

let gatewayClientInstance: GatewayClient | null = null;
let gatewayClientModeInstance: GatewayClientMode | null = null;

export function setGatewayClient(client: GatewayClient | null): void {
  gatewayClientInstance = client;
}

export function getGatewayClient(): GatewayClient | null {
  return gatewayClientInstance;
}

export function setGatewayClientMode(client: GatewayClientMode | null): void {
  gatewayClientModeInstance = client;
}

export function getGatewayClientMode(): GatewayClientMode | null {
  return gatewayClientModeInstance;
}
