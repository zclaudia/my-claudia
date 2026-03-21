import type Database from 'better-sqlite3';
import type { AgentTrigger } from '@my-claudia/shared';
import type { TaskOrchestrator } from '../../orchestration/types.js';
import type { AgentFeedService } from '../agent-feed/service.js';
import { AgentTriggerRepository } from './repository.js';

export interface AgentTriggerServiceDeps {
  db: Database.Database;
  orchestrator: TaskOrchestrator;
  feedService: AgentFeedService;
  pluginEvents: {
    on: (event: string, handler: (...args: any[]) => void) => void;
    off: (event: string, handler: (...args: any[]) => void) => void;
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
function matchesEventPattern(eventName: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern === eventName) return true;
  // Simple glob: convert * to regex .*
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  return regex.test(eventName);
}

export class AgentTriggerService {
  private repo: AgentTriggerRepository;
  private deps: AgentTriggerServiceDeps;
  private activeListeners = new Map<string, { event: string; handler: (...args: any[]) => void }>();

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
    for (const [, { event, handler }] of this.activeListeners) {
      this.deps.pluginEvents.off(event, handler);
    }
    this.activeListeners.clear();
    console.log('[AgentTriggerService] Stopped');
  }

  /** Subscribe to a plugin event for a trigger */
  private subscribeToEvent(trigger: AgentTrigger): void {
    const handler = (eventData: unknown) => {
      this.handleEvent(trigger, eventData).catch(err => {
        console.error(`[AgentTriggerService] Error handling event for trigger "${trigger.name}":`, err);
      });
    };
    // Subscribe to a broad event category; filter in handler
    const event = trigger.eventPattern!.split('*')[0].replace(/\.$/, '') || '*';
    this.deps.pluginEvents.on(event, handler);
    this.activeListeners.set(trigger.id, { event, handler });
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

    // Post "running" feed item
    const feedItem = trigger.feedDelivery
      ? this.deps.feedService.postItem({
          triggerId: trigger.id,
          source: trigger.triggerType === 'schedule' ? 'scheduled' : 'trigger',
          title: trigger.name,
          status: 'running',
          projectId: trigger.projectId ?? undefined,
        })
      : null;

    try {
      const taskId = await this.deps.orchestrator.spawnTask(null, {
        task: prompt,
        projectId: trigger.projectId,
        providerId: trigger.providerId,
        contextTemplate: trigger.contextTemplate || 'agent',
      });

      // Update feed item with task ID
      if (feedItem) {
        this.deps.feedService.updateItemStatus(feedItem.id, 'running');
      }

      // Wait for task completion (fire-and-forget, update feed on completion)
      this.deps.orchestrator.waitForTask(taskId).then(result => {
        if (feedItem) {
          this.deps.feedService.updateItemStatus(
            feedItem.id,
            result.status === 'completed' ? 'completed' : 'failed',
            {
              summary: result.summary,
              error: result.error,
            }
          );
        }
      }).catch(err => {
        if (feedItem) {
          this.deps.feedService.updateItemStatus(feedItem.id, 'failed', {
            error: err.message || 'Task execution failed',
          });
        }
      });
    } catch (err: unknown) {
      if (feedItem) {
        this.deps.feedService.updateItemStatus(feedItem.id, 'failed', {
          error: err instanceof Error ? err.message : 'Failed to spawn agent task',
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
      const listener = this.activeListeners.get(trigger.id);
      if (listener) {
        this.deps.pluginEvents.off(listener.event, listener.handler);
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
    const listener = this.activeListeners.get(id);
    if (listener) {
      this.deps.pluginEvents.off(listener.event, listener.handler);
      this.activeListeners.delete(id);
    }
    return this.repo.delete(id);
  }
}
