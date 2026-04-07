import { Router, Request, Response } from 'express';
import type { PCPEffectiveProfile } from '@my-claudia/shared/core/pcp';
import { toolRegistry } from './tool-registry.js';
import { shouldExposeInteractionTool } from '../../infrastructure/providers/pcp-capability.js';
import { sendApiError } from '../../interfaces/http/response.js';

export interface PluginToolsRoutesDeps {
  getActiveProfile?: (sessionId: string) => PCPEffectiveProfile | undefined;
  getSessionType?: (sessionId: string) => string | undefined;
  resolveActiveSessionId?: () => string | undefined;
}

export function createPluginToolsRoutes(deps?: PluginToolsRoutesDeps): Router {
  const router = Router();

  router.get('/tools', (req: Request, res: Response) => {
    const sessionId = (req.query.sessionId as string | undefined) || deps?.resolveActiveSessionId?.();
    const profile = sessionId ? deps?.getActiveProfile?.(sessionId) : undefined;
    const sessionType = sessionId ? deps?.getSessionType?.(sessionId) : undefined;
    const pluginTools = toolRegistry.getBridgeTools();
    const tools = pluginTools
      .filter(t => {
        if (t.scope?.includes('agent-assistant') && !t.scope?.includes('main-session')) {
          if (sessionType !== 'agent') return false;
        }
        return shouldExposeInteractionTool(t.definition.function.name, profile);
      })
      .map(t => ({
        name: t.definition.function.name,
        description: t.definition.function.description,
        inputSchema: t.definition.function.parameters,
      }));
    console.log(`[PluginTools] list tools count=${tools.length}${profile ? ` (filtered by PCP profile: ${profile.providerId})` : ''}`);
    res.json({ tools });
  });

  router.post('/tools/:name/execute', async (req: Request, res: Response) => {
    const { name } = req.params;
    const args = req.body.arguments || req.body.args || {};
    const context = { sessionId: (req.body.sessionId as string | undefined) || deps?.resolveActiveSessionId?.() };
    const sessionTag = context.sessionId || 'none';

    if (context.sessionId) {
      const tool = toolRegistry.get(name);
      if (tool?.scope?.includes('agent-assistant') && !tool.scope?.includes('main-session')) {
        const sType = deps?.getSessionType?.(context.sessionId);
        if (sType !== 'agent') {
          console.warn(`[PluginTools] rejected name=${name} session=${sessionTag} — agent-only tool in ${sType || 'unknown'} session`);
          res.json({ result: JSON.stringify({ error: `Tool "${name}" is only available in agent sessions` }) });
          return;
        }
      }

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
      sendApiError(
        res,
        500,
        'TOOL_EXECUTION_FAILED',
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  return router;
}
