import { Router, Request, Response } from 'express';
import { PluginManagementError, PluginManagementService } from './management-service.js';
import { PluginFrontendError, PluginFrontendService } from './frontend-service.js';
import { sendApiError } from '../../interfaces/http/response.js';

export function createPluginRoutes(): Router {
  const router = Router();
  const pluginManagementService = new PluginManagementService();
  const pluginFrontendService = new PluginFrontendService();

  router.get('/', (_req: Request, res: Response) => {
    const plugins = pluginManagementService.listPlugins();
    res.json({ success: true, data: plugins });
  });

  router.post('/:id/activate', async (req: Request, res: Response) => {
    try {
      const result = await pluginManagementService.activatePlugin(req.params.id);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof PluginManagementError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/:id/deactivate', async (req: Request, res: Response) => {
    try {
      const result = await pluginManagementService.deactivatePlugin(req.params.id);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof PluginManagementError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/:id/reload', async (req: Request, res: Response) => {
    try {
      const result = await pluginManagementService.reloadPlugin(req.params.id);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof PluginManagementError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/:id/permissions/grant', (req: Request, res: Response) => {
    try {
      const result = pluginManagementService.grantPermissions(req.params.id, req.body?.permissions);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof PluginManagementError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/:id/permissions/revoke', (req: Request, res: Response) => {
    try {
      const result = pluginManagementService.revokePermissions(req.params.id, req.body?.permissions);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof PluginManagementError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/dirs', (_req: Request, res: Response) => {
    res.json({ success: true, data: pluginManagementService.getPluginDirs() });
  });

  router.put('/dirs', (req: Request, res: Response) => {
    try {
      const result = pluginManagementService.updatePluginDirs(req.body?.dirs);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof PluginManagementError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/discover', async (_req: Request, res: Response) => {
    try {
      const result = await pluginManagementService.discoverPlugins();
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof PluginManagementError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/styles/claudia-ui.css', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/css');
    res.send(`/* Claudia UI – design tokens for plugin iframes */
/* Usage: <link rel="stylesheet" href="/api/plugins/styles/claudia-ui.css"> */

:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 0%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 0%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 0%;
  --primary: 211 100% 50%;
  --primary-foreground: 0 0% 100%;
  --secondary: 240 6% 95%;
  --secondary-foreground: 0 0% 20%;
  --muted: 240 5% 96%;
  --muted-foreground: 240 3% 46%;
  --accent: 240 6% 93%;
  --accent-foreground: 0 0% 20%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 100%;
  --success: 142.1 76.2% 36.3%;
  --success-foreground: 355.7 100% 97.3%;
  --warning: 38 92% 50%;
  --warning-foreground: 48 96% 89%;
  --thinking: 265 60% 55%;
  --thinking-foreground: 265 80% 98%;
  --border: 240 6% 90%;
  --input: 240 6% 90%;
  --ring: 211 100% 50%;
  --radius: 0.75rem;
  --scrollbar-thumb: 240 4% 75%;
  --scrollbar-thumb-hover: 240 4% 60%;
  --terminal-bg: 240 5% 96%;
  --terminal-fg: 0 0% 0%;
  --terminal-cursor: 211 100% 50%;
  --terminal-selection: 211 100% 90%;
}

.dark {
  --background: 240 10% 4%;
  --foreground: 0 0% 98%;
  --card: 240 10% 4%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 4%;
  --popover-foreground: 0 0% 98%;
  --primary: 211 100% 50%;
  --primary-foreground: 0 0% 100%;
  --secondary: 240 4% 16%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 4% 16%;
  --muted-foreground: 240 5% 65%;
  --accent: 240 4% 16%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 63% 31%;
  --destructive-foreground: 0 0% 100%;
  --success: 142.1 76.2% 36.3%;
  --success-foreground: 355.7 100% 97.3%;
  --warning: 38 92% 50%;
  --warning-foreground: 48 96% 89%;
  --thinking: 265 60% 55%;
  --thinking-foreground: 265 80% 98%;
  --border: 240 4% 16%;
  --input: 240 4% 16%;
  --ring: 211 100% 50%;
  --scrollbar-thumb: 240 4% 35%;
  --scrollbar-thumb-hover: 240 4% 50%;
  --terminal-bg: 240 10% 4%;
  --terminal-fg: 0 0% 98%;
  --terminal-cursor: 211 100% 50%;
  --terminal-selection: 211 100% 25%;
}`);
  });

  router.get('/styles/plugin-sdk.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`/* Claudia Plugin SDK – iframe helper (auto-generated) */
(function () {
  const SDK_PROTOCOL_VERSION = 1;

  const ClaudiaSDK = {
    _initialized: false,
    _handlers: {},

    ready() {
      window.parent.postMessage({ type: 'claudia:ready', protocol: SDK_PROTOCOL_VERSION }, '*');
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'claudia:init' || msg.type === 'claudia:theme-changed') {
          if (msg.protocol > SDK_PROTOCOL_VERSION) {
            console.warn('[ClaudiaSDK] Host protocol v' + msg.protocol + ' > SDK v' + SDK_PROTOCOL_VERSION + '. Update plugin-sdk.js.');
          }
          ClaudiaSDK._applyTheme(msg.themeClasses || [], msg.cssVars || {});
          if (!ClaudiaSDK._initialized) {
            ClaudiaSDK._initialized = true;
            ClaudiaSDK._emit('init', msg);
          } else {
            ClaudiaSDK._emit('themeChanged', msg);
          }
        }
      });
    },

    _applyTheme(classes, vars) {
      const html = document.documentElement;
      ['dark', 'dark-warm', 'dark-cool', 'dark-neutral'].forEach(c => html.classList.remove(c));
      classes.forEach(c => html.classList.add(c));
      Object.entries(vars).forEach(([k, v]) => html.style.setProperty(k, v));
    },

    on(event, handler) {
      if (!ClaudiaSDK._handlers[event]) ClaudiaSDK._handlers[event] = [];
      ClaudiaSDK._handlers[event].push(handler);
    },

    _emit(event, data) {
      (ClaudiaSDK._handlers[event] || []).forEach(h => { try { h(data); } catch(e) {} });
    },

    showNotification(message) {
      window.parent.postMessage({ type: 'claudia:show-notification', message }, '*');
    },

    resize(height) {
      window.parent.postMessage({ type: 'claudia:resize', height }, '*');
    },
  };

  window.ClaudiaSDK = ClaudiaSDK;
})();
`);
  });

  router.get('/:id/frontend/*', async (req: Request, res: Response) => {
    try {
      const fullPath = pluginFrontendService.resolveFrontendFile(
        req.params.id,
        (req.params as any)[0] as string,
      );
      res.sendFile(fullPath);
    } catch (error) {
      if (error instanceof PluginFrontendError) {
        res.status(error.status).send(error.message);
        return;
      }
      res.status(500).send(error instanceof Error ? error.message : String(error));
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const result = await pluginManagementService.removePlugin(req.params.id);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof PluginManagementError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  return router;
}
