import { Router, Request, Response } from 'express';
import type { ApiResponse, SupervisionTask, ProjectAgent } from '@my-claudia/shared';
import type { SupervisorV2Service } from '../services/supervisor-v2-service.js';
import type { ContextDocument } from '../services/context-manager.js';

export function createSupervisionV2Routes(service: SupervisorV2Service): Router {
  const router = Router();

  // POST /projects/:projectId/agent/init — Initialize agent
  router.post('/projects/:projectId/agent/init', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { config } = req.body;
      const agent = service.initAgent(projectId, config);
      res.json({ success: true, data: agent } as ApiResponse<ProjectAgent>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize agent';
      res.status(400).json({
        success: false,
        error: { code: 'INIT_ERROR', message },
      } as ApiResponse<never>);
    }
  });

  // POST /projects/:projectId/agent/action — Pause/resume/archive/approve_setup
  router.post('/projects/:projectId/agent/action', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { action } = req.body;
      if (!action || !['pause', 'resume', 'archive', 'approve_setup'].includes(action)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'action must be one of: pause, resume, archive, approve_setup' },
        } as ApiResponse<never>);
        return;
      }
      const agent = service.updateAgentPhase(projectId, action);
      res.json({ success: true, data: agent } as ApiResponse<ProjectAgent>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update agent';
      const status = message.includes('not in') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 400 ? 'INVALID_STATE' : 'INTERNAL_ERROR', message },
      } as ApiResponse<never>);
    }
  });

  // GET /projects/:projectId/agent — Get agent state
  router.get('/projects/:projectId/agent', (req: Request, res: Response) => {
    try {
      const agent = service.getAgent(req.params.projectId);
      if (!agent) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'No agent for this project' },
        } as ApiResponse<never>);
        return;
      }
      res.json({ success: true, data: agent } as ApiResponse<ProjectAgent>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get agent' },
      } as ApiResponse<never>);
    }
  });

  // GET /projects/:projectId/tasks — List tasks
  router.get('/projects/:projectId/tasks', (req: Request, res: Response) => {
    try {
      const tasks = service.getTasks(req.params.projectId);
      res.json({ success: true, data: tasks } as ApiResponse<SupervisionTask[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to list tasks' },
      } as ApiResponse<never>);
    }
  });

  // POST /projects/:projectId/tasks — Create task
  router.post('/projects/:projectId/tasks', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { title, description, dependencies, dependencyMode, priority, acceptanceCriteria, relevantDocIds, scope } = req.body;
      if (!title || !description) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'title and description are required' },
        } as ApiResponse<never>);
        return;
      }
      const task = service.createTask(projectId, {
        title, description, dependencies, dependencyMode, priority,
        acceptanceCriteria, relevantDocIds, scope,
      });
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create task';
      const status = message.includes('budget') ? 409 : message.includes('No agent') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 409 ? 'BUDGET_EXCEEDED' : 'INTERNAL_ERROR', message },
      } as ApiResponse<never>);
    }
  });

  // PUT /tasks/:taskId — Update task
  router.put('/tasks/:taskId', (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = service.updateTask(taskId, req.body);
      if (!task) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        } as ApiResponse<never>);
        return;
      }
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to update task' },
      } as ApiResponse<never>);
    }
  });

  // POST /tasks/:taskId/approve — Approve proposed task
  router.post('/tasks/:taskId/approve', (req: Request, res: Response) => {
    try {
      const task = service.approveTask(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve task';
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message },
      } as ApiResponse<never>);
    }
  });

  // POST /tasks/:taskId/reject — Reject proposed task
  router.post('/tasks/:taskId/reject', (req: Request, res: Response) => {
    try {
      const task = service.rejectTask(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject task';
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message },
      } as ApiResponse<never>);
    }
  });

  // POST /tasks/:taskId/review/approve — Manual review: approve (may trigger merge)
  router.post('/tasks/:taskId/review/approve', async (req: Request, res: Response) => {
    try {
      const task = await service.approveTaskResult(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve task result';
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message },
      } as ApiResponse<never>);
    }
  });

  // POST /tasks/:taskId/review/reject — Manual review: reject
  router.post('/tasks/:taskId/review/reject', (req: Request, res: Response) => {
    try {
      const { notes } = req.body;
      if (!notes) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'notes are required' },
        } as ApiResponse<never>);
        return;
      }
      const task = service.rejectTaskResult(req.params.taskId, notes);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject task result';
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_STATE', message },
      } as ApiResponse<never>);
    }
  });

  // POST /tasks/:taskId/resolve-conflict — Resolve merge conflict
  router.post('/tasks/:taskId/resolve-conflict', async (req: Request, res: Response) => {
    try {
      const task = await service.resolveConflict(req.params.taskId);
      res.json({ success: true, data: task } as ApiResponse<SupervisionTask>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to resolve conflict';
      const status = message.includes('not in merge_conflict') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: { code: status === 400 ? 'INVALID_STATE' : 'MERGE_ERROR', message },
      } as ApiResponse<never>);
    }
  });

  // POST /projects/:projectId/context/reload — Reload .supervision/
  router.post('/projects/:projectId/context/reload', (req: Request, res: Response) => {
    try {
      service.reloadContext(req.params.projectId);
      res.json({ success: true, data: null } as ApiResponse<null>);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reload context';
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message },
      } as ApiResponse<never>);
    }
  });

  // GET /projects/:projectId/budget — Get token usage
  router.get('/projects/:projectId/budget', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const usage = service.getTokenUsage(projectId);
      const agent = service.getAgent(projectId);
      const limit = agent?.config?.maxTokenBudget;
      res.json({
        success: true,
        data: { usage, limit, remaining: limit !== undefined ? Math.max(0, limit - usage) : undefined },
      } as ApiResponse<{ usage: number; limit?: number; remaining?: number }>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get budget' },
      } as ApiResponse<never>);
    }
  });

  // GET /projects/:projectId/logs — Get supervision logs
  router.get('/projects/:projectId/logs', (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = service.getLogs(projectId, limit);
      res.json({ success: true, data: logs } as ApiResponse<any[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get logs' },
      } as ApiResponse<never>);
    }
  });

  // GET /projects/:projectId/context — Get context documents
  router.get('/projects/:projectId/context', (req: Request, res: Response) => {
    try {
      const documents = service.getContextDocuments(req.params.projectId);
      res.json({ success: true, data: documents } as ApiResponse<ContextDocument[]>);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to get context documents' },
      } as ApiResponse<never>);
    }
  });

  return router;
}
