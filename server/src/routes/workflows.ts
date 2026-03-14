/**
 * Workflow API Routes
 *
 * CRUD, trigger, run management, template instantiation, step approval.
 */

import { Router, Request, Response } from 'express';
import type { WorkflowService } from '../services/workflow-service.js';
import type { WorkflowGeneratorService } from '../services/workflow-generator.js';
import type { WorkflowStepTypeMeta, WorkflowDefinition } from '@my-claudia/shared';
import { isV2Definition } from '@my-claudia/shared';
import { isValidCron } from '../utils/cron.js';
import { workflowStepRegistry } from '../plugins/workflow-step-registry.js';

export function createWorkflowRoutes(service: WorkflowService, generatorService?: WorkflowGeneratorService): Router {
  const router = Router();

  // GET /api/projects/:projectId/workflows
  router.get('/projects/:projectId/workflows', (req: Request, res: Response) => {
    try {
      const workflows = service.listWorkflows(req.params.projectId);
      res.json({ success: true, data: workflows });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/projects/:projectId/workflows
  router.post('/projects/:projectId/workflows', (req: Request, res: Response) => {
    try {
      const { name, description, definition, status } = req.body;
      if (!name) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Name is required' },
        });
      }
      // Accept both V1 (steps+triggers) and V2 (nodes+edges+entryNodeId+triggers)
      const isV1 = definition?.steps && definition?.triggers;
      const isV2 = definition?.version === 2 && definition?.nodes && definition?.edges && definition?.triggers;
      if (!isV1 && !isV2) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Definition must have triggers and either steps (V1) or nodes+edges+entryNodeId (V2)' },
        });
      }

      // V2: validate entryNodeId exists
      if (isV2) {
        const nodeIds = new Set((definition.nodes as any[]).map((n: any) => n.id));
        if (!definition.entryNodeId || !nodeIds.has(definition.entryNodeId)) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'entryNodeId must reference an existing node' },
          });
        }
      }

      // Validate cron expressions
      for (const trigger of definition.triggers) {
        if (trigger.type === 'cron' && trigger.cron && !isValidCron(trigger.cron)) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: `Invalid cron expression: ${trigger.cron}` },
          });
        }
      }

      const workflow = service.createWorkflow({
        projectId: req.params.projectId,
        name,
        description,
        definition,
        status,
      });
      res.status(201).json({ success: true, data: workflow });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/workflows/:workflowId
  router.get('/workflows/:workflowId', (req: Request, res: Response) => {
    try {
      const workflow = service.getWorkflow(req.params.workflowId);
      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Workflow not found' },
        });
      }
      res.json({ success: true, data: workflow });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // PATCH /api/workflows/:workflowId
  router.patch('/workflows/:workflowId', (req: Request, res: Response) => {
    try {
      const existing = service.getWorkflow(req.params.workflowId);
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Workflow not found' },
        });
      }

      // Validate cron if definition is being updated
      if (req.body.definition?.triggers) {
        for (const trigger of req.body.definition.triggers) {
          if (trigger.type === 'cron' && trigger.cron && !isValidCron(trigger.cron)) {
            return res.status(400).json({
              success: false,
              error: { code: 'VALIDATION_ERROR', message: `Invalid cron expression: ${trigger.cron}` },
            });
          }
        }
      }

      const workflow = service.updateWorkflow(req.params.workflowId, req.body);
      res.json({ success: true, data: workflow });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // DELETE /api/workflows/:workflowId
  router.delete('/workflows/:workflowId', (req: Request, res: Response) => {
    try {
      const workflow = service.getWorkflow(req.params.workflowId);
      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Workflow not found' },
        });
      }
      service.deleteWorkflow(req.params.workflowId, workflow.projectId);
      res.json({ success: true, data: null });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/workflow-templates
  router.get('/workflow-templates', (_req: Request, res: Response) => {
    res.json({ success: true, data: service.getTemplates() });
  });

  // POST /api/projects/:projectId/workflows/from-template/:templateId
  router.post('/projects/:projectId/workflows/from-template/:templateId', (req: Request, res: Response) => {
    try {
      const workflow = service.createFromTemplate(req.params.projectId, req.params.templateId);
      res.status(201).json({ success: true, data: workflow });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/workflows/:workflowId/trigger
  router.post('/workflows/:workflowId/trigger', async (req: Request, res: Response) => {
    try {
      const run = await service.triggerWorkflow(req.params.workflowId);
      res.json({ success: true, data: run });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/workflows/:workflowId/runs
  router.get('/workflows/:workflowId/runs', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const runs = service.getRuns(req.params.workflowId, limit);
      res.json({ success: true, data: runs });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/workflow-runs/:runId
  router.get('/workflow-runs/:runId', (req: Request, res: Response) => {
    try {
      const result = service.getRun(req.params.runId);
      if (!result) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Run not found' },
        });
      }
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/workflow-runs/:runId/cancel
  router.post('/workflow-runs/:runId/cancel', (req: Request, res: Response) => {
    try {
      const cancelled = service.cancelRun(req.params.runId);
      if (!cancelled) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATE', message: 'Run cannot be cancelled (not running or pending)' },
        });
      }
      res.json({ success: true, data: null });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/workflow-step-runs/:stepRunId/approve
  router.post('/workflow-step-runs/:stepRunId/approve', (req: Request, res: Response) => {
    try {
      const approved = service.approveStep(req.params.stepRunId);
      if (!approved) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATE', message: 'Step is not waiting for approval' },
        });
      }
      res.json({ success: true, data: null });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/workflow-step-runs/:stepRunId/reject
  router.post('/workflow-step-runs/:stepRunId/reject', (req: Request, res: Response) => {
    try {
      const rejected = service.rejectStep(req.params.stepRunId);
      if (!rejected) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATE', message: 'Step is not waiting for approval' },
        });
      }
      res.json({ success: true, data: null });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/projects/:projectId/workflows/generate
  router.post('/projects/:projectId/workflows/generate', async (req: Request, res: Response) => {
    if (!generatorService) {
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Workflow generator not available' },
      });
    }
    try {
      const { description, providerId } = req.body;
      if (!description) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'description is required' },
        });
      }
      if (!providerId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'providerId is required' },
        });
      }
      const result = await generatorService.generate(req.params.projectId, description, providerId);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'GENERATION_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/projects/:projectId/workflows/generate/refine
  router.post('/projects/:projectId/workflows/generate/refine', async (req: Request, res: Response) => {
    if (!generatorService) {
      return res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Workflow generator not available' },
      });
    }
    try {
      const { generationId, instruction } = req.body;
      if (!generationId || !instruction) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'generationId and instruction are required' },
        });
      }
      const result = await generatorService.refine(req.params.projectId, generationId, instruction);
      res.json({ success: true, data: result });
    } catch (error) {
      const status = (error instanceof Error && error.message.includes('not found')) ? 404 : 500;
      res.status(status).json({
        success: false,
        error: { code: 'GENERATION_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/workflow-step-types
  router.get('/workflow-step-types', (_req: Request, res: Response) => {
    const builtinMeta: WorkflowStepTypeMeta[] = [
      { type: 'git_commit', name: 'Git Commit', description: 'Commit changes', category: 'Git', source: 'builtin' },
      { type: 'git_merge', name: 'Git Merge', description: 'Merge branches', category: 'Git', source: 'builtin' },
      { type: 'create_worktree', name: 'Create Worktree', description: 'Create a git worktree', category: 'Git', source: 'builtin' },
      { type: 'create_pr', name: 'Create PR', description: 'Create a pull request', category: 'Git', source: 'builtin' },
      { type: 'ai_review', name: 'AI Review', description: 'AI code review', category: 'AI', source: 'builtin' },
      { type: 'ai_prompt', name: 'AI Prompt', description: 'Send prompt to AI', category: 'AI', source: 'builtin' },
      { type: 'shell', name: 'Shell Command', description: 'Execute shell command', category: 'Automation', source: 'builtin' },
      { type: 'webhook', name: 'Webhook', description: 'HTTP webhook call', category: 'Automation', source: 'builtin' },
      { type: 'notify', name: 'Notify', description: 'Send notification', category: 'Automation', source: 'builtin' },
      { type: 'condition', name: 'Condition', description: 'Conditional branching', category: 'Flow Control', source: 'builtin' },
      { type: 'wait', name: 'Wait / Approval', description: 'Wait or require approval', category: 'Flow Control', source: 'builtin' },
    ];
    const pluginMeta = workflowStepRegistry.getAllMeta();
    res.json({ success: true, data: [...builtinMeta, ...pluginMeta] });
  });

  return router;
}
