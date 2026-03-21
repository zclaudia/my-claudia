import { Router, Request, Response } from 'express';
import type { AgentTriggerService } from '../domains/agent-triggers/service.js';

export function createAgentTriggerRoutes(triggerService: AgentTriggerService): Router {
  const router = Router();

  // GET /api/agent-triggers — List all triggers
  router.get('/', (_req: Request, res: Response) => {
    try {
      const triggers = triggerService.listTriggers();
      res.json({ success: true, data: triggers });
    } catch (error) {
      console.error('Error listing triggers:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list triggers' } });
    }
  });

  // GET /api/agent-triggers/:id — Get single trigger
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const trigger = triggerService.getTrigger(req.params.id);
      if (!trigger) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Trigger not found' } });
        return;
      }
      res.json({ success: true, data: trigger });
    } catch (error) {
      console.error('Error getting trigger:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get trigger' } });
    }
  });

  // POST /api/agent-triggers — Create trigger
  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, promptTemplate } = req.body;
      if (!name || !promptTemplate) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'name and promptTemplate are required' } });
        return;
      }
      const trigger = triggerService.createTrigger({
        name,
        description: req.body.description,
        enabled: req.body.enabled !== false,
        triggerType: req.body.triggerType || 'event',
        eventPattern: req.body.eventPattern,
        eventFilter: req.body.eventFilter,
        promptTemplate,
        providerId: req.body.providerId,
        projectId: req.body.projectId,
        contextTemplate: req.body.contextTemplate,
        feedDelivery: req.body.feedDelivery !== false,
        notifyDelivery: req.body.notifyDelivery === true,
      });
      res.status(201).json({ success: true, data: trigger });
    } catch (error) {
      console.error('Error creating trigger:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create trigger' } });
    }
  });

  // PUT /api/agent-triggers/:id — Update trigger
  router.put('/:id', (req: Request, res: Response) => {
    try {
      triggerService.updateTrigger(req.params.id, req.body);
      const updated = triggerService.getTrigger(req.params.id);
      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error updating trigger:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update trigger' } });
    }
  });

  // DELETE /api/agent-triggers/:id — Delete trigger
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const deleted = triggerService.deleteTrigger(req.params.id);
      if (!deleted) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Trigger not found' } });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting trigger:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete trigger' } });
    }
  });

  return router;
}
