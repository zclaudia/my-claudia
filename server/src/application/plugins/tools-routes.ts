import { Router, Request, Response } from 'express';
import type { PCPEffectiveProfile } from '@my-claudia/shared/core/pcp';
import { toolRegistry, type ToolScope } from './tool-registry.js';
import { shouldExposeInteractionTool } from '../../infrastructure/providers/pcp-capability.js';
import { sendApiError } from '../../interfaces/http/response.js';

export interface PluginToolsRoutesDeps {
  getActiveProfile?: (sessionId: string) => PCPEffectiveProfile | undefined;
  getSessionType?: (sessionId: string) => string | undefined;
  resolveActiveSessionId?: () => string | undefined;
}

/**
 * Map (sessionId, sessionType) to the caller's ToolScope.
 *   - no sessionId            → 'plugin-panel'  (request originates from a plugin iframe)
 *   - sessionType === 'agent' → 'agent-assistant'
 *   - otherwise               → 'main-session'
 */
function resolveCallerScope(
  sessionId: string | undefined,
  sessionType: string | undefined,
): ToolScope {
  if (!sessionId) return 'plugin-panel';
  if (sessionType === 'agent') return 'agent-assistant';
  return 'main-session';
}

export function createPluginToolsRoutes(deps?: PluginToolsRoutesDeps): Router {
  const router = Router();

  router.get('/tools', (req: Request, res: Response) => {
    const sessionId = (req.query.sessionId as string | undefined) || deps?.resolveActiveSessionId?.();
    const profile = sessionId ? deps?.getActiveProfile?.(sessionId) : undefined;
    const sessionType = sessionId ? deps?.getSessionType?.(sessionId) : undefined;
    const callerScope = resolveCallerScope(sessionId, sessionType);
    // Allow-list filter via the registry (undefined scope = callable everywhere).
    const allowedNames = new Set(
      toolRegistry.getDefinitionsByScope(callerScope).map(d => d.function.name),
    );
    const pluginTools = toolRegistry.getBridgeTools();
    const tools = pluginTools
      .filter(t => allowedNames.has(t.definition.function.name))
      .filter(t => shouldExposeInteractionTool(t.definition.function.name, profile))
      .map(t => ({
        name: t.definition.function.name,
        description: t.definition.function.description,
        inputSchema: t.definition.function.parameters,
      }));
    console.log(`[PluginTools] list tools count=${tools.length} scope=${callerScope}${profile ? ` (filtered by PCP profile: ${profile.providerId})` : ''}`);
    res.json({ tools });
  });

  router.post('/tools/:name/execute', async (req: Request, res: Response) => {
    const { name } = req.params;
    const args = req.body.arguments || req.body.args || {};
    const context = { sessionId: (req.body.sessionId as string | undefined) || deps?.resolveActiveSessionId?.() };
    const sessionTag = context.sessionId || 'none';
    const sessionType = context.sessionId ? deps?.getSessionType?.(context.sessionId) : undefined;
    const callerScope = resolveCallerScope(context.sessionId, sessionType);

    if (context.sessionId) {
      const profile = deps?.getActiveProfile?.(context.sessionId);
      if (profile && !shouldExposeInteractionTool(name, profile)) {
        console.warn(`[PluginTools] rejected name=${name} session=${sessionTag} — capability not supported by ${profile.providerId}`);
        res.json({ result: JSON.stringify({ error: `Tool "${name}" is not available for this provider` }) });
        return;
      }
    }

    try {
      console.log(`[PluginTools] execute start name=${name} session=${sessionTag} scope=${callerScope} args=${Object.keys(args).join(',') || 'none'}`);
      const result = await toolRegistry.execute(name, args, context, callerScope);
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
