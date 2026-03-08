/**
 * Scheduled Task API Routes
 *
 * CRUD + manual trigger + built-in template management.
 */

import { Router, Request, Response } from 'express';
import type { ApiResponse, ScheduledTask, ScheduledTaskTemplate } from '@my-claudia/shared';
import type { ScheduledTaskService } from '../services/scheduled-task-service.js';
import { isValidCron } from '../utils/cron.js';
import { BUILTIN_TEMPLATES } from '../scheduled-task-templates.js';

export function createScheduledTaskRoutes(service: ScheduledTaskService): Router {
  const router = Router();

  // GET /api/projects/:projectId/scheduled-tasks — list project tasks
  router.get('/projects/:projectId/scheduled-tasks', (req: Request, res: Response) => {
    try {
      const tasks = service.getRepo().findByProjectId(req.params.projectId);
      res.json({ success: true, data: tasks } as ApiResponse<ScheduledTask[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/scheduled-tasks/global — list global tasks
  router.get('/scheduled-tasks/global', (_req: Request, res: Response) => {
    try {
      const tasks = service.getRepo().findGlobalTasks();
      res.json({ success: true, data: tasks } as ApiResponse<ScheduledTask[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/projects/:projectId/scheduled-tasks — create project task
  router.post('/projects/:projectId/scheduled-tasks', (req: Request, res: Response) => {
    try {
      const task = createTask(service, req.body, req.params.projectId);
      res.status(201).json({ success: true, data: task } as ApiResponse<ScheduledTask>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('Validation') ? 400 : 500;
      res.status(status).json({ success: false, error: { code: status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message } });
    }
  });

  // POST /api/scheduled-tasks/global — create global task
  router.post('/scheduled-tasks/global', (req: Request, res: Response) => {
    try {
      const task = createTask(service, req.body, undefined);
      res.status(201).json({ success: true, data: task } as ApiResponse<ScheduledTask>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('Validation') ? 400 : 500;
      res.status(status).json({ success: false, error: { code: status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message } });
    }
  });

  // PATCH /api/scheduled-tasks/:taskId — update
  router.patch('/scheduled-tasks/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const body = req.body;

      if (body.scheduleCron && !isValidCron(body.scheduleCron)) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid cron expression' } });
        return;
      }

      const existing = service.getRepo().findById(taskId);
      if (!existing) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Scheduled task not found' } });
        return;
      }

      // Recompute nextRun if schedule params changed
      if (body.scheduleCron !== undefined || body.scheduleIntervalMinutes !== undefined ||
          body.scheduleOnceAt !== undefined || body.enabled !== undefined) {
        const merged = { ...existing, ...body };
        body.nextRun = body.enabled === false
          ? null
          : service.computeInitialNextRun(merged);
      }

      const updated = service.getRepo().update(taskId, body);
      res.json({ success: true, data: updated } as ApiResponse<ScheduledTask>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // DELETE /api/scheduled-tasks/:taskId
  router.delete('/scheduled-tasks/:taskId', (req: Request, res: Response) => {
    try {
      const task = service.getRepo().findById(req.params.taskId);
      if (!task) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Scheduled task not found' } });
        return;
      }
      service.getRepo().delete(req.params.taskId);
      service.broadcastDelete(task.projectId, task.id);
      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // POST /api/scheduled-tasks/:taskId/trigger — manual run
  router.post('/scheduled-tasks/:taskId/trigger', async (req: Request, res: Response) => {
    try {
      const task = service.getRepo().findById(req.params.taskId);
      if (!task) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Scheduled task not found' } });
        return;
      }
      // Fire and forget
      service.triggerNow(task.id).catch((err) =>
        console.error(`[ScheduledTasks] Manual trigger error for ${task.id}:`, err),
      );
      // Return the freshest state (status will be 'running')
      const fresh = service.getRepo().findById(task.id);
      res.json({ success: true, data: fresh } as ApiResponse<ScheduledTask>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  // GET /api/scheduled-task-templates — list built-in templates
  router.get('/scheduled-task-templates', (_req: Request, res: Response) => {
    res.json({ success: true, data: BUILTIN_TEMPLATES } as ApiResponse<ScheduledTaskTemplate[]>);
  });

  // POST /api/projects/:projectId/scheduled-tasks/from-template/:templateId
  router.post('/projects/:projectId/scheduled-tasks/from-template/:templateId', (req: Request, res: Response) => {
    try {
      const { projectId, templateId } = req.params;
      const template = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
      if (!template) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
        return;
      }

      // Toggle if already instantiated
      const existing = service.getRepo().findByTemplateId(projectId, templateId);
      if (existing) {
        const nextRun = !existing.enabled ? service.computeInitialNextRun(existing) : null;
        const updated = service.getRepo().update(existing.id, {
          enabled: !existing.enabled,
          nextRun: nextRun ?? undefined,
        });
        res.json({ success: true, data: updated } as ApiResponse<ScheduledTask>);
        return;
      }

      const nextRun = service.computeInitialNextRun({
        scheduleType: template.scheduleType,
        scheduleCron: template.defaultSchedule.cron,
        scheduleIntervalMinutes: template.defaultSchedule.intervalMinutes,
      });

      const task = service.getRepo().create({
        projectId,
        name: template.name,
        description: template.description,
        enabled: true,
        scheduleType: template.scheduleType,
        scheduleCron: template.defaultSchedule.cron,
        scheduleIntervalMinutes: template.defaultSchedule.intervalMinutes,
        nextRun: nextRun ?? undefined,
        actionType: template.actionType,
        actionConfig: template.defaultActionConfig,
        templateId: template.id,
      });

      res.status(201).json({ success: true, data: task } as ApiResponse<ScheduledTask>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  return router;
}

// ── Helpers ─────────────────────────────────────────────────────

function createTask(
  service: ScheduledTaskService,
  body: any,
  projectId: string | undefined,
): ScheduledTask {
  if (!body.name) throw new Error('Validation: name is required');

  const validScheduleTypes = ['cron', 'interval', 'once'];
  if (!body.scheduleType || !validScheduleTypes.includes(body.scheduleType)) {
    throw new Error('Validation: scheduleType must be cron, interval, or once');
  }

  if (body.scheduleType === 'cron' && body.scheduleCron && !isValidCron(body.scheduleCron)) {
    throw new Error('Validation: Invalid cron expression');
  }

  const validActionTypes = ['prompt', 'command', 'shell', 'webhook', 'plugin_event'];
  if (!body.actionType || !validActionTypes.includes(body.actionType)) {
    throw new Error('Validation: actionType must be prompt, command, shell, webhook, or plugin_event');
  }

  const nextRun = service.computeInitialNextRun(body);

  return service.getRepo().create({
    projectId,
    name: body.name,
    description: body.description,
    enabled: body.enabled ?? true,
    scheduleType: body.scheduleType,
    scheduleCron: body.scheduleCron,
    scheduleIntervalMinutes: body.scheduleIntervalMinutes,
    scheduleOnceAt: body.scheduleOnceAt,
    nextRun: nextRun ?? undefined,
    actionType: body.actionType,
    actionConfig: body.actionConfig ?? {},
    templateId: body.templateId,
  });
}
