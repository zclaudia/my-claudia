/**
 * Agent Trigger Service
 *
 * @deprecated Legacy event-driven trigger runtime. New event automations should
 * use Workflows with event triggers via /api/automations. This service will be
 * removed after migration. See docs/design/automation-unification-findings.md.
 */

import type Database from 'better-sqlite3';
import type { AgentTrigger } from '@my-claudia/shared';
import type { TaskOrchestrator } from '../orchestration/types.js';
import type { NotificationFeedService } from '../notification-feed/service.js';
import { AgentTriggerRepository } from './repository.js';

export interface AgentTriggerServiceDeps {
  db: Database.Database;
  orchestrator: TaskOrchestrator;
  notificationService: NotificationFeedService;
  pluginEvents: {
    on: (event: string, handler: (...args: unknown[]) => void) => (() => void) | void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
    onPattern?: (pattern: string, handler: (...args: unknown[]) => void) => (() => void) | void;
    offPattern?: (pattern: string, handler: (...args: unknown[]) => void) => void;
  };
}

/** Render a simple template: replaces {{key}} and {{event.key}} with data values */
function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split('.');
    let value: unknown = data;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }
    return String(value ?? '');
  });
}

/** Check if event name matches a trigger's pattern (simple glob: * matches any segment) */
export class AgentTriggerService {
  private repo: AgentTriggerRepository;
  private deps: AgentTriggerServiceDeps;
  private activeListeners = new Map<string, () => void>();

  constructor(deps: AgentTriggerServiceDeps) {
    this.deps = deps;
    this.repo = new AgentTriggerRepository(deps.db);
  }

  /** Load all enabled triggers and subscribe to events */
  start(): void {
    const triggers = this.repo.findEnabled();
    for (const trigger of triggers) {
      if (trigger.eventPattern) {
        this.subscribeToEvent(trigger);
      }
    }
    console.log(`[AgentTriggerService] Started with ${triggers.length} enabled triggers`);
  }

  /** Unsubscribe all event listeners */
  stop(): void {
    for (const [, unsubscribe] of this.activeListeners) {
      unsubscribe();
    }
    this.activeListeners.clear();
    console.log('[AgentTriggerService] Stopped');
  }

  /** Subscribe to a plugin event for a trigger */
  private subscribeToEvent(trigger: AgentTrigger): void {
    if (!trigger.eventPattern) return;
    const handler = (eventData: unknown) => {
      this.handleEvent(trigger, eventData).catch(err => {
        console.error(`[AgentTriggerService] Error handling event for trigger "${trigger.name}":`, err);
      });
    };

    const pattern = trigger.eventPattern!;
    const unsubscribe = pattern.includes('*') && this.deps.pluginEvents.onPattern
      ? this.deps.pluginEvents.onPattern(pattern, handler)
      : this.deps.pluginEvents.on(pattern, handler);

    this.activeListeners.set(trigger.id, () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
        return;
      }
      if (pattern.includes('*')) {
        this.deps.pluginEvents.offPattern?.(pattern, handler);
      } else {
        this.deps.pluginEvents.off(pattern, handler);
      }
    });
  }

  /** Handle an incoming event against a trigger */
  private async handleEvent(trigger: AgentTrigger, eventData: unknown): Promise<void> {
    // Check event filter if specified
    if (trigger.eventFilter && eventData && typeof eventData === 'object') {
      const data = eventData as Record<string, unknown>;
      for (const [key, expected] of Object.entries(trigger.eventFilter)) {
        if (data[key] !== expected) return; // filter mismatch
      }
    }

    await this.executeAgentPrompt(trigger, { event: eventData });
  }

  /** Execute an agent task from a trigger, posting result to feed */
  async executeAgentPrompt(trigger: AgentTrigger, context: Record<string, unknown> = {}): Promise<void> {
    const prompt = renderTemplate(trigger.promptTemplate, context);

    try {
      await this.deps.orchestrator.spawnTask(null, {
        task: prompt,
        projectId: trigger.projectId,
        providerId: trigger.providerId,
        contextTemplate: trigger.contextTemplate || 'agent',
        feed: trigger.feedDelivery
          ? {
              triggerId: trigger.id,
              source: trigger.triggerType === 'schedule' ? 'scheduled' : 'trigger',
              title: trigger.name,
            }
          : undefined,
      });
    } catch (err: unknown) {
      if (trigger.feedDelivery) {
        this.deps.notificationService.postItem({
          triggerId: trigger.id,
          source: trigger.triggerType === 'schedule' ? 'scheduled' : 'trigger',
          title: trigger.name,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Failed to spawn agent task',
          projectId: trigger.projectId ?? undefined,
        });
      }
    }
  }

  /** Register a trigger from plugin manifest */
  registerPluginTrigger(pluginId: string, contrib: { event: string; promptTemplate: string; name: string; description?: string }): AgentTrigger {
    const trigger = this.repo.create({
      name: contrib.name,
      description: contrib.description,
      enabled: true,
      triggerType: 'event',
      eventPattern: contrib.event,
      promptTemplate: contrib.promptTemplate,
      feedDelivery: true,
      notifyDelivery: false,
      sourcePluginId: pluginId,
    });
    this.subscribeToEvent(trigger);
    return trigger;
  }

  /** Unregister all triggers from a plugin */
  unregisterPluginTriggers(pluginId: string): void {
    const triggers = this.repo.findByPluginId(pluginId);
    for (const trigger of triggers) {
      const unsubscribe = this.activeListeners.get(trigger.id);
      if (unsubscribe) {
        unsubscribe();
        this.activeListeners.delete(trigger.id);
      }
    }
    this.repo.deleteByPluginId(pluginId);
  }

  /** Reload: stop all, re-read from DB, re-subscribe */
  reload(): void {
    this.stop();
    this.start();
  }

  // CRUD pass-through for REST routes
  listTriggers(): AgentTrigger[] { return this.repo.findAll(); }
  getTrigger(id: string): AgentTrigger | undefined { return this.repo.findById(id); }
  createTrigger(data: Omit<AgentTrigger, 'id' | 'createdAt' | 'updatedAt'>): AgentTrigger {
    const trigger = this.repo.create(data);
    if (trigger.enabled && trigger.eventPattern) this.subscribeToEvent(trigger);
    return trigger;
  }
  updateTrigger(id: string, updates: Partial<AgentTrigger>): void {
    this.repo.update(id, updates);
    this.reload(); // Simplest approach: reload all listeners on any change
  }
  deleteTrigger(id: string): boolean {
    const unsubscribe = this.activeListeners.get(id);
    if (unsubscribe) {
      unsubscribe();
      this.activeListeners.delete(id);
    }
    return this.repo.delete(id);
  }
}
