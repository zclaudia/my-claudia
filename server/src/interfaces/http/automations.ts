/**
 * Automations API — simplified creation of single-node workflows.
 *
 * This is the unified automation entry point. Under the hood, automations
 * are persisted as Workflow entities with authoringMode metadata.
 */

import { Router, type Request, type Response } from 'express';
import type { WorkflowService } from '../../domains/workflows/index.js';
import type { WorkflowNodeDef, WorkflowTrigger, WorkflowTriggerType } from '@my-claudia/shared/features/workflows';
import { v4 as uuidv4 } from 'uuid';

interface SimpleAutomationBody {
  name: string;
  description?: string;
  projectId?: string;
  trigger: {
    type: WorkflowTriggerType;
    cron?: string;
    intervalMinutes?: number;
    onceAt?: number;
    event?: string;
    eventFilter?: Record<string, unknown>;
  };
  action: {
    type: string;
    config: Record<string, unknown>;
  };
}

export function createAutomationRoutes(workflowService: WorkflowService): Router {
  const router = Router();

  // POST /api/automations — create a simple single-node workflow
  router.post('/', (req: Request, res: Response) => {
    try {
      const body = req.body as SimpleAutomationBody;

      if (!body.name?.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'name is required' },
        });
      }
      if (!body.trigger?.type) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'trigger.type is required' },
        });
      }
      if (!body.action?.type) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'action.type is required' },
        });
      }
      if (body.trigger.type === 'cron' && !body.trigger.cron?.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'trigger.cron is required for cron triggers' },
        });
      }
      if (body.trigger.type === 'interval' && (!body.trigger.intervalMinutes || body.trigger.intervalMinutes < 1)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'trigger.intervalMinutes must be >= 1 for interval triggers' },
        });
      }
      if (body.trigger.type === 'once' && typeof body.trigger.onceAt !== 'number') {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'trigger.onceAt is required for one-time triggers' },
        });
      }
      if (body.trigger.type === 'event' && !body.trigger.event?.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'trigger.event is required for event triggers' },
        });
      }

      const nodeId = uuidv4().slice(0, 8);
      const trigger: WorkflowTrigger = {
        type: body.trigger.type,
        cron: body.trigger.cron,
        intervalMinutes: body.trigger.intervalMinutes,
        onceAt: body.trigger.onceAt,
        event: body.trigger.event,
        eventFilter: body.trigger.eventFilter,
      };

      const node: WorkflowNodeDef = {
        id: nodeId,
        name: body.name,
        type: body.action.type,
        config: body.action.config || {},
        position: { x: 300, y: 100 },
      };

      const workflow = workflowService.createWorkflow({
        projectId: body.projectId,
        name: body.name,
        description: body.description,
        definition: {
          nodes: [node],
          edges: [],
          entryNodeId: nodeId,
          triggers: [trigger],
        },
        sourceType: 'user',
        authoringMode: 'simple',
      });

      res.status(201).json({ success: true, data: workflow });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/automations — list simple automations, optionally filtered by projectId
  router.get('/', (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const workflows = (projectId
        ? workflowService.listWorkflows(projectId)
        : workflowService.listAllWorkflows()
      ).filter((w) => w.authoringMode === 'simple');
      res.json({ success: true, data: workflows });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/automations/:id/trigger — manual trigger (proxy to workflow)
  router.post('/:id/trigger', async (req: Request, res: Response) => {
    try {
      const run = await workflowService.triggerWorkflow(req.params.id, 'manual');
      res.json({ success: true, data: run });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/automations/:id/runs — run history (proxy to workflow runs)
  router.get('/:id/runs', (req: Request, res: Response) => {
    try {
      const runs = workflowService.getRuns(req.params.id);
      res.json({ success: true, data: runs });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  return router;
}
