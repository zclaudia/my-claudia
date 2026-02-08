import { Router, Request, Response } from 'express';
import type { Database } from 'better-sqlite3';
import type { GatewayBackendInfo } from '@my-claudia/shared';

export interface GatewayConfig {
  id: number;
  enabled: boolean;
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  backendName: string | null;
  backendId: string | null;
  registerAsBackend: boolean;
  proxyUrl?: string | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GatewayStatus {
  enabled: boolean;
  connected: boolean;
  backendId: string | null;
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  backendName: string | null;
  registerAsBackend: boolean;
  discoveredBackends: GatewayBackendInfo[];
}

export function createGatewayRouter(
  db: Database,
  getGatewayStatus: () => GatewayStatus,
  connectGateway: (config: GatewayConfig) => Promise<void>,
  disconnectGateway: () => Promise<void>
): Router {
  const router = Router();

  // Get Gateway configuration
  router.get('/config', (_req: Request, res: Response) => {
    try {
      const row = db.prepare(`
        SELECT id, enabled, gateway_url, gateway_secret, backend_name, backend_id,
               register_as_backend,
               proxy_url, proxy_username, proxy_password,
               created_at, updated_at
        FROM gateway_config
        WHERE id = 1
      `).get() as any;

      if (!row) {
        return res.json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Gateway config not found' }
        });
      }

      const config: GatewayConfig = {
        id: row.id,
        enabled: row.enabled === 1,
        gatewayUrl: row.gateway_url,
        gatewaySecret: row.gateway_secret,
        backendName: row.backend_name,
        backendId: row.backend_id,
        registerAsBackend: row.register_as_backend === 1,
        proxyUrl: row.proxy_url,
        proxyUsername: row.proxy_username,
        proxyPassword: row.proxy_password,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      // Don't send secrets to the client
      const safeConfig = {
        ...config,
        gatewaySecret: config.gatewaySecret ? '********' : null,
        proxyPassword: config.proxyPassword ? '********' : null
      };

      res.json({ success: true, data: safeConfig });
    } catch (error) {
      console.error('Error getting gateway config:', error);
      res.json({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get gateway config'
        }
      });
    }
  });

  // Update Gateway configuration
  router.put('/config', async (req: Request, res: Response) => {
    try {
      const { enabled, gatewayUrl, gatewaySecret, backendName, registerAsBackend, proxyUrl, proxyUsername, proxyPassword } = req.body;

      // Validate required fields if enabling
      if (enabled && (!gatewayUrl || !gatewaySecret)) {
        return res.json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Gateway URL and Secret are required when enabling'
          }
        });
      }

      const updates: string[] = [];
      const params: any[] = [];

      if (typeof enabled === 'boolean') {
        updates.push('enabled = ?');
        params.push(enabled ? 1 : 0);
      }

      if (gatewayUrl !== undefined) {
        updates.push('gateway_url = ?');
        params.push(gatewayUrl);
      }

      if (gatewaySecret !== undefined) {
        updates.push('gateway_secret = ?');
        params.push(gatewaySecret);
      }

      if (backendName !== undefined) {
        updates.push('backend_name = ?');
        params.push(backendName);
      }

      if (typeof registerAsBackend === 'boolean') {
        updates.push('register_as_backend = ?');
        params.push(registerAsBackend ? 1 : 0);
      }

      if (proxyUrl !== undefined) {
        updates.push('proxy_url = ?');
        params.push(proxyUrl);
      }

      if (proxyUsername !== undefined) {
        updates.push('proxy_username = ?');
        params.push(proxyUsername);
      }

      if (proxyPassword !== undefined) {
        updates.push('proxy_password = ?');
        params.push(proxyPassword);
      }

      updates.push('updated_at = ?');
      params.push(Date.now());

      params.push(1); // WHERE id = 1

      db.prepare(`
        UPDATE gateway_config
        SET ${updates.join(', ')}
        WHERE id = ?
      `).run(...params);

      // Get updated config
      const row = db.prepare(`
        SELECT id, enabled, gateway_url, gateway_secret, backend_name, backend_id,
               register_as_backend,
               proxy_url, proxy_username, proxy_password,
               created_at, updated_at
        FROM gateway_config
        WHERE id = 1
      `).get() as any;

      const config: GatewayConfig = {
        id: row.id,
        enabled: row.enabled === 1,
        gatewayUrl: row.gateway_url,
        gatewaySecret: row.gateway_secret,
        backendName: row.backend_name,
        backendId: row.backend_id,
        registerAsBackend: row.register_as_backend === 1,
        proxyUrl: row.proxy_url,
        proxyUsername: row.proxy_username,
        proxyPassword: row.proxy_password,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      // If enabled, connect to gateway
      if (config.enabled && config.gatewayUrl && config.gatewaySecret) {
        await connectGateway(config);
      } else {
        await disconnectGateway();
      }

      // Don't send secrets to the client
      const safeConfig = {
        ...config,
        gatewaySecret: config.gatewaySecret ? '********' : null,
        proxyPassword: config.proxyPassword ? '********' : null
      };

      res.json({ success: true, data: safeConfig });
    } catch (error) {
      console.error('Error updating gateway config:', error);
      res.json({
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to update gateway config'
        }
      });
    }
  });

  // Get Gateway status (connection state)
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const status = getGatewayStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      console.error('Error getting gateway status:', error);
      res.json({
        success: false,
        error: {
          code: 'STATUS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get gateway status'
        }
      });
    }
  });

  // Manually connect to Gateway (if enabled)
  router.post('/connect', async (_req: Request, res: Response) => {
    try {
      const row = db.prepare(`
        SELECT id, enabled, gateway_url, gateway_secret, backend_name, backend_id,
               register_as_backend,
               proxy_url, proxy_username, proxy_password,
               created_at, updated_at
        FROM gateway_config
        WHERE id = 1
      `).get() as any;

      if (!row) {
        return res.json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Gateway config not found' }
        });
      }

      const config: GatewayConfig = {
        id: row.id,
        enabled: row.enabled === 1,
        gatewayUrl: row.gateway_url,
        gatewaySecret: row.gateway_secret,
        backendName: row.backend_name,
        backendId: row.backend_id,
        registerAsBackend: row.register_as_backend === 1,
        proxyUrl: row.proxy_url,
        proxyUsername: row.proxy_username,
        proxyPassword: row.proxy_password,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      if (!config.enabled) {
        return res.json({
          success: false,
          error: { code: 'DISABLED', message: 'Gateway is disabled' }
        });
      }

      if (!config.gatewayUrl || !config.gatewaySecret) {
        return res.json({
          success: false,
          error: { code: 'NOT_CONFIGURED', message: 'Gateway URL or Secret not configured' }
        });
      }

      await connectGateway(config);

      res.json({ success: true, data: { message: 'Connecting to gateway...' } });
    } catch (error) {
      console.error('Error connecting to gateway:', error);
      res.json({
        success: false,
        error: {
          code: 'CONNECT_FAILED',
          message: error instanceof Error ? error.message : 'Failed to connect to gateway'
        }
      });
    }
  });

  // Manually disconnect from Gateway
  router.post('/disconnect', async (_req: Request, res: Response) => {
    try {
      await disconnectGateway();
      res.json({ success: true, data: { message: 'Disconnected from gateway' } });
    } catch (error) {
      console.error('Error disconnecting from gateway:', error);
      res.json({
        success: false,
        error: {
          code: 'DISCONNECT_FAILED',
          message: error instanceof Error ? error.message : 'Failed to disconnect from gateway'
        }
      });
    }
  });

  return router;
}
