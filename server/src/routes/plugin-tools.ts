/**
 * Plugin Tools API Routes
 *
 * Provides HTTP endpoints for the MCP bridge to list and execute plugin tools.
 * These routes are used by the MCP bridge process to proxy tool calls
 * from the Claude SDK back to the main server's tool registry.
 */

import { Router, Request, Response } from 'express';
import type { PCPEffectiveProfile } from '@my-claudia/shared';
import { toolRegistry } from '../plugins/tool-registry.js';
import { shouldExposeInteractionTool } from '../providers/pcp-capability.js';

export interface PluginToolsRoutesDeps {
  /** Resolve the active PCP profile for a session (if a run is active) */
  getActiveProfile?: (sessionId: string) => PCPEffectiveProfile | undefined;
}

export function createPluginToolsRoutes(deps?: PluginToolsRoutesDeps): Router {
  const router = Router();

  /**
   * GET /api/plugins/tools
   * List all plugin tools in MCP-compatible format.
   * Optional ?sessionId= to filter by PCP capability.
   */
  router.get('/tools', (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const profile = sessionId ? deps?.getActiveProfile?.(sessionId) : undefined;

    const pluginTools = toolRegistry.getBridgeTools();
    const tools = pluginTools
      .filter(t => shouldExposeInteractionTool(t.definition.function.name, profile))
      .map(t => ({
        name: t.definition.function.name,
        description: t.definition.function.description,
        inputSchema: t.definition.function.parameters,
      }));
    console.log(`[PluginTools] list tools count=${tools.length}${profile ? ` (filtered by PCP profile: ${profile.providerId})` : ''}`);
    res.json({ tools });
  });

  /**
   * POST /api/plugins/tools/:name/execute
   * Execute a plugin tool by name.
   */
  router.post('/tools/:name/execute', async (req: Request, res: Response) => {
    const { name } = req.params;
    const args = req.body.arguments || req.body.args || {};
    const context = { sessionId: req.body.sessionId as string | undefined };
    const sessionTag = context.sessionId || 'none';

    // PCP capability check: reject if tool shouldn't be exposed for this provider
    if (context.sessionId) {
      const profile = deps?.getActiveProfile?.(context.sessionId);
      if (profile && !shouldExposeInteractionTool(name, profile)) {
        console.warn(`[PluginTools] rejected name=${name} session=${sessionTag} — capability not supported by ${profile.providerId}`);
        res.json({ result: JSON.stringify({ error: `Tool "${name}" is not available for this provider` }) });
        return;
      }
    }

    try {
      console.log(`[PluginTools] execute start name=${name} session=${sessionTag} args=${Object.keys(args).join(',') || 'none'}`);
      const result = await toolRegistry.execute(name, args, context);
      console.log(`[PluginTools] execute ok name=${name} session=${sessionTag} resultLength=${String(result).length}`);
      res.json({ result });
    } catch (error) {
      console.error(`[PluginTools] execute failed name=${name} session=${sessionTag}:`, error);
      res.status(500).json({
        error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  return router;
}
