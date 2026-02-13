/**
 * Global gateway client instance holder
 * This allows routes and other modules to access the gateway client
 * without circular dependencies
 */
import type { GatewayClient } from './gateway-client.js';

let gatewayClientInstance: GatewayClient | null = null;

export function setGatewayClient(client: GatewayClient | null): void {
  gatewayClientInstance = client;
}

export function getGatewayClient(): GatewayClient | null {
  return gatewayClientInstance;
}
