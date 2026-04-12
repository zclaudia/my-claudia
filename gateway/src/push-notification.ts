import type { GatewayStorage } from './storage.js';
import type { NotificationConfig } from '@my-claudia/shared/interaction/notifications';
import type { PushNotificationRequestMessage } from '@my-claudia/shared/protocol/gateway';
import { DEFAULT_NOTIFICATION_CONFIG } from '@my-claudia/shared/interaction/notifications';

type NotifyEvent = PushNotificationRequestMessage['event'];

const EVENT_KEY_MAP: Record<NotifyEvent['type'], keyof NotificationConfig['events']> = {
  permission_request: 'permissionRequest',
  prompt_request: 'promptRequest',
  run_completed: 'runCompleted',
  run_failed: 'runFailed',
  background_permission: 'backgroundPermission',
  process_leak: 'processLeak',
};

export class GatewayPushNotificationService {
  private configCache: NotificationConfig | null = null;

  constructor(private storage: GatewayStorage) {}

  getConfig(): NotificationConfig {
    if (this.configCache) return this.configCache;

    const raw = this.storage.getNotificationConfig();
    if (raw) {
      try {
        this.configCache = this.normalizeConfig(JSON.parse(raw));
        return this.configCache;
      } catch {
        // Fall through to default
      }
    }

    return DEFAULT_NOTIFICATION_CONFIG;
  }

  saveConfig(config: NotificationConfig): void {
    const normalized = this.normalizeConfig(config);
    this.storage.saveNotificationConfig(JSON.stringify(normalized));
    this.configCache = normalized;
  }

  private normalizeConfig(config: Partial<NotificationConfig>): NotificationConfig {
    const legacyPromptRequest = (config.events as Record<string, unknown> | undefined)?.askUserQuestion;
    return {
      ...DEFAULT_NOTIFICATION_CONFIG,
      ...config,
      events: {
        ...DEFAULT_NOTIFICATION_CONFIG.events,
        ...(typeof legacyPromptRequest === 'boolean' ? { promptRequest: legacyPromptRequest } : {}),
        ...(config.events || {}),
      },
    };
  }

  async notify(event: NotifyEvent): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled || !config.ntfyTopic) return;

    const eventKey = EVENT_KEY_MAP[event.type];
    if (!eventKey || !config.events[eventKey]) return;

    const url = `${config.ntfyUrl.replace(/\/$/, '')}/${config.ntfyTopic}`;

    const headers: Record<string, string> = {
      Title: event.title,
      Priority: event.priority || 'default',
    };

    if (event.tags && event.tags.length > 0) {
      headers.Tags = event.tags.join(',');
    }

    if (event.clickUrl) {
      headers.Click = event.clickUrl;
    }

    try {
      await fetch(url, { method: 'POST', headers, body: event.body });
    } catch (err) {
      console.error('[Gateway/Notification] Failed to send ntfy notification:', err);
    }
  }

  async sendTest(): Promise<void> {
    const config = this.getConfig();
    if (!config.ntfyTopic) {
      throw new Error('ntfy topic is not configured');
    }

    const url = `${config.ntfyUrl.replace(/\/$/, '')}/${config.ntfyTopic}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Title: 'MyClaudia - Test Notification',
        Priority: 'default',
        Tags: 'white_check_mark',
      },
      body: 'If you see this, notifications are working!',
    });

    if (!response.ok) {
      throw new Error(`ntfy returned ${response.status}: ${response.statusText}`);
    }
  }
}
