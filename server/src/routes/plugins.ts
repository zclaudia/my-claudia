/**
 * Plugin Management API Routes
 *
 * Provides HTTP endpoints for managing plugins: listing, activating,
 * deactivating, and managing permissions.
 */

import { Router, Request, Response } from 'express';
import { pluginLoader } from '../plugins/loader.js';
import { PluginManagementError, PluginManagementService } from '../services/plugin-management-service.js';
import { PluginFrontendError, PluginFrontendService } from '../services/plugin-frontend-service.js';
import { sendApiError } from './response.js';

export function createPluginRoutes(): Router {
  const router = Router();
  const pluginManagementService = new PluginManagementService();
  const pluginFrontendService = new PluginFrontendService();

  /**
   * GET /api/plugins
   * List all discovered plugins with their status and permissions.
   */
  router.get('/', (_req: Request, res: Response) => {
    const plugins = pluginManagementService.listPlugins();
    res.json({ success: true, data: plugins });
  });

  /**
   * POST /api/plugins/:id/activate
   * Activate a plugin by ID.
   */
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

  /**
   * POST /api/plugins/:id/deactivate
   * Deactivate a plugin by ID.
   */
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

  /**
   * POST /api/plugins/:id/reload
   * Hot-reload a plugin: deactivate → clear cache → re-read manifest → activate.
   */
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

  /**
   * POST /api/plugins/:id/permissions/grant
   * Grant permissions to a plugin.
   */
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

  /**
   * POST /api/plugins/:id/permissions/revoke
   * Revoke permissions from a plugin.
   */
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

  /**
   * GET /api/plugins/dirs
   * List all plugin scan directories (default + user-configured).
   */
  router.get('/dirs', (_req: Request, res: Response) => {
    res.json({ success: true, data: pluginManagementService.getPluginDirs() });
  });

  /**
   * PUT /api/plugins/dirs
   * Set user-configured extra plugin directories.
   */
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

  /**
   * POST /api/plugins/discover
   * Re-scan plugin directories to discover new plugins.
   */
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

  /**
   * GET /api/plugins/styles/claudia-ui.css
   * Serves Claudia's design-token CSS variables for all four themes.
   * Plugin iframes can @import this to match the host app's visual style.
   */
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
  --background: 220 8% 8%;
  --foreground: 210 15% 93%;
  --card: 220 7% 10%;
  --card-foreground: 210 15% 93%;
  --popover: 220 7% 10%;
  --popover-foreground: 210 15% 93%;
  --primary: 211 100% 52%;
  --primary-foreground: 0 0% 100%;
  --secondary: 220 6% 14%;
  --secondary-foreground: 210 12% 88%;
  --muted: 220 6% 14%;
  --muted-foreground: 215 10% 58%;
  --accent: 220 7% 17%;
  --accent-foreground: 210 12% 88%;
  --destructive: 0 62% 55%;
  --destructive-foreground: 0 0% 98%;
  --success: 142 50% 42%;
  --success-foreground: 142 60% 10%;
  --warning: 40 80% 52%;
  --warning-foreground: 30 70% 12%;
  --thinking: 265 45% 58%;
  --thinking-foreground: 265 60% 95%;
  --border: 220 8% 18%;
  --input: 220 7% 16%;
  --ring: 211 100% 52%;
  --scrollbar-thumb: 220 8% 28%;
  --scrollbar-thumb-hover: 220 8% 36%;
  --terminal-bg: 220 8% 6%;
  --terminal-fg: 210 15% 93%;
  --terminal-cursor: 211 100% 52%;
  --terminal-selection: 220 7% 20%;
}

.dark.dark-warm {
  --background: 30 6% 7.5%;
  --foreground: 40 12% 92%;
  --card: 30 6% 10%;
  --card-foreground: 40 12% 92%;
  --popover: 30 6% 10%;
  --popover-foreground: 40 12% 92%;
  --primary: 211 100% 52%;
  --primary-foreground: 0 0% 100%;
  --secondary: 28 5% 14%;
  --secondary-foreground: 35 10% 86%;
  --muted: 28 5% 14%;
  --muted-foreground: 30 8% 55%;
  --accent: 28 6% 17%;
  --accent-foreground: 35 10% 86%;
  --destructive: 0 60% 53%;
  --destructive-foreground: 0 0% 98%;
  --success: 145 48% 40%;
  --success-foreground: 145 55% 10%;
  --warning: 42 78% 52%;
  --warning-foreground: 32 65% 12%;
  --thinking: 270 40% 55%;
  --thinking-foreground: 270 50% 95%;
  --border: 30 7% 18%;
  --input: 30 6% 16%;
  --ring: 211 100% 52%;
  --scrollbar-thumb: 30 6% 26%;
  --scrollbar-thumb-hover: 30 6% 34%;
  --terminal-bg: 30 6% 6%;
  --terminal-fg: 40 12% 92%;
  --terminal-cursor: 211 100% 52%;
  --terminal-selection: 28 6% 20%;
}

.dark.dark-cool {
  --background: 225 18% 7%;
  --foreground: 215 20% 93%;
  --card: 225 16% 9.5%;
  --card-foreground: 215 20% 93%;
  --popover: 225 16% 9.5%;
  --popover-foreground: 215 20% 93%;
  --primary: 211 100% 52%;
  --primary-foreground: 0 0% 100%;
  --secondary: 222 14% 13.5%;
  --secondary-foreground: 215 15% 87%;
  --muted: 222 14% 13.5%;
  --muted-foreground: 218 12% 56%;
  --accent: 222 15% 17%;
  --accent-foreground: 215 15% 87%;
  --destructive: 0 60% 55%;
  --destructive-foreground: 0 0% 98%;
  --success: 142 52% 43%;
  --success-foreground: 142 60% 10%;
  --warning: 42 82% 52%;
  --warning-foreground: 30 70% 12%;
  --thinking: 260 50% 60%;
  --thinking-foreground: 260 60% 95%;
  --border: 222 16% 19%;
  --input: 222 14% 16%;
  --ring: 211 100% 52%;
  --scrollbar-thumb: 222 14% 28%;
  --scrollbar-thumb-hover: 222 14% 36%;
  --terminal-bg: 225 18% 5.5%;
  --terminal-fg: 215 20% 93%;
  --terminal-cursor: 211 100% 52%;
  --terminal-selection: 222 15% 20%;
}

/* Convenience utilities */
*, *::before, *::after { box-sizing: border-box; }

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  margin: 0;
}

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: hsl(var(--scrollbar-thumb)); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: hsl(var(--scrollbar-thumb-hover)); }
`);
  });

  /**
   * GET /api/plugins/styles/plugin-sdk.js
   * Lightweight JS helper that wires up theme sync for iframe panels.
   * Plugin HTML can <script src="/api/plugins/styles/plugin-sdk.js"></script>
   * and then call ClaudiaSDK.ready() to opt-in to theme synchronization.
   */
  router.get('/styles/plugin-sdk.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`/* Claudia Plugin SDK – iframe helper (auto-generated) */
(function () {
  const SDK_PROTOCOL_VERSION = 1;

  const ClaudiaSDK = {
    _initialized: false,
    _handlers: {},

    /**
     * Call this once your plugin UI is ready.
     * The SDK will signal the host and apply theme when host responds.
     */
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

    /** Apply theme classes and CSS vars to this document's <html>. */
    _applyTheme(classes, vars) {
      const html = document.documentElement;
      // Remove old theme classes
      ['dark', 'dark-warm', 'dark-cool', 'dark-neutral'].forEach(c => html.classList.remove(c));
      // Apply new ones
      classes.forEach(c => html.classList.add(c));
      // Apply CSS vars
      Object.entries(vars).forEach(([k, v]) => html.style.setProperty(k, v));
    },

    /** Register a callback for SDK events: 'init', 'themeChanged' */
    on(event, handler) {
      if (!ClaudiaSDK._handlers[event]) ClaudiaSDK._handlers[event] = [];
      ClaudiaSDK._handlers[event].push(handler);
    },

    _emit(event, data) {
      (ClaudiaSDK._handlers[event] || []).forEach(h => { try { h(data); } catch(e) {} });
    },

    /** Send a notification to the host app. */
    showNotification(message) {
      window.parent.postMessage({ type: 'claudia:show-notification', message }, '*');
    },

    /** Request a panel height resize. */
    resize(height) {
      window.parent.postMessage({ type: 'claudia:resize', height }, '*');
    },
  };

  window.ClaudiaSDK = ClaudiaSDK;
})();
`);
  });

  /**
   * GET /api/plugins/:id/frontend/*
   * Serve plugin UI files for iframe-based panels.
   * Only serves files within the plugin's own directory (path traversal safe).
   */
  router.get('/:id/frontend/*', (req: Request, res: Response) => {
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

  /**
   * DELETE /api/plugins/:id
   * Deactivate and remove a plugin from the registry (does not delete files).
   */
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
