import type { Express, Request, RequestHandler, Response } from 'express';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { pipeline } from 'stream';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { createMcpServerRoutes } from '../../interfaces/http/mcp-servers.js';
import { handleMcpRequest, handleMcpSse, handleMcpSessionClose, getMcpServerInfo } from '../../interfaces/mcp/mcp-server.js';
import { createSystemStatsRoutes } from '../../interfaces/http/system-stats.js';
import { createDebugRoutes } from '../../interfaces/http/debug.js';
import { createSystemTaskRoutes } from '../../interfaces/http/system-tasks.js';
import { createWorkspaceRoutes } from '../../interfaces/http/workspace.js';
import { createGatewayRouter } from '../../interfaces/http/gateway.js';
import type { ProcessSupervisor } from '../../infrastructure/services/process-supervisor.js';
import type { GatewayState } from '../../infrastructure/gateway/gateway-state.js';
import { getGatewayClient } from '../../infrastructure/gateway/gateway-instance.js';

interface RegisterPlatformRoutesDeps {
  app: Express;
  db: ReturnType<typeof initDatabase>;
  authMiddleware: RequestHandler;
  localOnlyMiddleware: RequestHandler;
  processSupervisor: ProcessSupervisor;
  gateway: GatewayState;
  getServerPort: () => number | null;
  oneShotRuntime?: import('../oneshot/types.js').OneShotTaskRuntime;
  workflowEngine?: import('../../domains/workflows/engine.js').WorkflowEngine;
  permissionWorkflowResolver?: import('../../domains/workflows/index.js').PermissionWorkflowResolver;
}

export function registerPlatformRoutes(deps: RegisterPlatformRoutesDeps): void {
  const { app, db, authMiddleware, localOnlyMiddleware, processSupervisor, gateway, getServerPort, oneShotRuntime, workflowEngine, permissionWorkflowResolver } = deps;

  app.use('/api/mcp-servers', authMiddleware, createMcpServerRoutes(db));

  app.post('/mcp', authMiddleware, async (req: Request, res: Response) => {
    await handleMcpRequest(req, res, req.body);
  });
  app.get('/mcp', authMiddleware, async (req: Request, res: Response) => {
    await handleMcpSse(req, res);
  });
  app.delete('/mcp', authMiddleware, async (req: Request, res: Response) => {
    await handleMcpSessionClose(req, res);
  });
  app.get('/mcp/info', authMiddleware, (_req: Request, res: Response) => {
    res.json(getMcpServerInfo());
  });

  app.get('/api/mcp-export', authMiddleware, (_req: Request, res: Response) => {
    const port = getServerPort() ?? 3100;
    res.json({
      claudia: {
        type: 'url',
        url: `http://localhost:${port}/mcp`,
      },
    });
  });

  app.use('/api/system', localOnlyMiddleware, createSystemStatsRoutes());
  app.use('/api/debug', localOnlyMiddleware, createDebugRoutes(processSupervisor, db, oneShotRuntime, workflowEngine, permissionWorkflowResolver));
  app.use('/api', authMiddleware, createSystemTaskRoutes());
  app.use('/api/workspace', authMiddleware, createWorkspaceRoutes());

  app.use('/api/server/gateway', localOnlyMiddleware, createGatewayRouter(
    db,
    gateway.getGatewayStatus,
    gateway.connectGateway,
    gateway.disconnectGateway,
  ));

  app.get('/api/gateway/backends', localOnlyMiddleware, async (_req: Request, res: Response) => {
    try {
      const clientMode: any = null;
      if (!clientMode || !clientMode.isConnected()) {
        res.json({ success: true, data: [] });
        return;
      }
      const backends = await clientMode.listBackends();
      res.json({ success: true, data: backends });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list backends' },
      });
    }
  });

  app.all('/api/gateway-proxy/:backendId/*', localOnlyMiddleware, async (req: Request, res: Response) => {
    const { backendId } = req.params;
    const subPath = req.params[0] || '';

    const gatewayClient = getGatewayClient();
    if (!gatewayClient || !gatewayClient.queries.connection.isConnected()) {
      res.status(502).json({
        success: false,
        error: { code: 'GATEWAY_NOT_CONNECTED', message: 'Gateway client not connected' },
      });
      return;
    }

    try {
      const targetUrl = `${gatewayClient.queries.connection.getGatewayUrl()}/api/proxy/${backendId}/${subPath}`;
      const qs = req.originalUrl.split('?')[1];
      const fullUrl = qs ? `${targetUrl}?${qs}` : targetUrl;

      const headers: Record<string, string> = {
        authorization: `Bearer ${gatewayClient.queries.connection.getGatewaySecret()}`,
      };
      for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (value == null) continue;
        if (lowerKey === 'authorization' || lowerKey === 'host' || lowerKey === 'connection') continue;
        headers[key] = Array.isArray(value) ? value.join(', ') : value;
      }

      const agent = gatewayClient.queries.connection.createHttpAgent();
      const body = !['GET', 'HEAD'].includes(req.method)
        ? (Buffer.isBuffer(req.body)
          ? req.body
          : typeof req.body === 'string'
            ? Buffer.from(req.body)
            : req.body != null
              ? Buffer.from(JSON.stringify(req.body))
              : null)
        : null;
      if (body) {
        headers['content-length'] = String(body.length);
      } else {
        delete headers['content-length'];
      }

      const parsed = new URL(fullUrl);
      const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

      await new Promise<void>((resolve, reject) => {
        const proxyReq = transport(fullUrl, {
          method: req.method,
          headers,
          agent: agent || undefined,
        }, (upstream) => {
          res.status(upstream.statusCode || 502);
          for (const [key, val] of Object.entries(upstream.headers)) {
            if (!val || key.toLowerCase() === 'transfer-encoding') continue;
            res.setHeader(key, Array.isArray(val) ? val.join(', ') : val);
          }

          pipeline(upstream, res, (error) => {
            if (error && !res.writableEnded) {
              reject(error);
              return;
            }
            resolve();
          });
        });

        const abortUpstream = () => {
          proxyReq.destroy();
        };

        req.on('aborted', abortUpstream);
        res.on('close', abortUpstream);
        proxyReq.on('error', reject);
        proxyReq.on('close', () => {
          req.off('aborted', abortUpstream);
          res.off('close', abortUpstream);
        });

        if (body) {
          proxyReq.end(body);
        } else {
          proxyReq.end();
        }
      });
    } catch (error) {
      console.error(`[GatewayProxy] Error proxying to backend ${backendId}:`, error);
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      res.status(502).json({
        success: false,
        error: { code: 'PROXY_ERROR', message: 'Failed to proxy request to gateway' },
      });
    }
  });

  // Gateway-direct proxy: forward requests to the gateway's own API endpoints
  // (not to a specific backend). Used by desktop for notification config, etc.
  app.all('/api/gateway-direct/*', localOnlyMiddleware, async (req: Request, res: Response) => {
    const subPath = req.params[0] || '';

    const gatewayClient = getGatewayClient();
    if (!gatewayClient || !gatewayClient.queries.connection.isConnected()) {
      res.status(502).json({
        success: false,
        error: { code: 'GATEWAY_NOT_CONNECTED', message: 'Gateway client not connected' },
      });
      return;
    }

    try {
      const gatewayUrl = gatewayClient.queries.connection.getGatewayUrl();
      const targetUrl = `${gatewayUrl}/${subPath}`;
      const qs = req.originalUrl.split('?')[1];
      const fullUrl = qs ? `${targetUrl}?${qs}` : targetUrl;

      const headers: Record<string, string> = {
        authorization: `Bearer ${gatewayClient.queries.connection.getGatewaySecret()}`,
      };
      for (const [key, value] of Object.entries(req.headers)) {
        const lowerKey = key.toLowerCase();
        if (value == null) continue;
        if (lowerKey === 'authorization' || lowerKey === 'host' || lowerKey === 'connection') continue;
        headers[key] = Array.isArray(value) ? value.join(', ') : value;
      }

      const agent = gatewayClient.queries.connection.createHttpAgent();
      const body = !['GET', 'HEAD'].includes(req.method)
        ? (Buffer.isBuffer(req.body)
          ? req.body
          : typeof req.body === 'string'
            ? Buffer.from(req.body)
            : req.body != null
              ? Buffer.from(JSON.stringify(req.body))
              : null)
        : null;
      if (body) {
        headers['content-length'] = String(body.length);
      } else {
        delete headers['content-length'];
      }

      const parsed = new URL(fullUrl);
      const transport = parsed.protocol === 'https:' ? httpsRequest : httpRequest;

      await new Promise<void>((resolve, reject) => {
        const proxyReq = transport(fullUrl, {
          method: req.method,
          headers,
          agent: agent || undefined,
        }, (upstream) => {
          res.status(upstream.statusCode || 502);
          for (const [key, val] of Object.entries(upstream.headers)) {
            if (!val || key.toLowerCase() === 'transfer-encoding') continue;
            res.setHeader(key, Array.isArray(val) ? val.join(', ') : val);
          }

          pipeline(upstream, res, (error) => {
            if (error && !res.writableEnded) {
              reject(error);
              return;
            }
            resolve();
          });
        });

        const abortUpstream = () => {
          proxyReq.destroy();
        };

        req.on('aborted', abortUpstream);
        res.on('close', abortUpstream);
        proxyReq.on('error', reject);
        proxyReq.on('close', () => {
          req.off('aborted', abortUpstream);
          res.off('close', abortUpstream);
        });

        if (body) {
          proxyReq.end(body);
        } else {
          proxyReq.end();
        }
      });
    } catch (error) {
      console.error('[GatewayDirect] Error proxying to gateway:', error);
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      res.status(502).json({
        success: false,
        error: { code: 'PROXY_ERROR', message: 'Failed to proxy request to gateway' },
      });
    }
  });
}
