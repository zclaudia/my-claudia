import type Database from 'better-sqlite3';
import type { NotificationConfig } from '@my-claudia/shared';
import { DEFAULT_NOTIFICATION_CONFIG } from '@my-claudia/shared';

type NtfyPriority = 'urgent' | 'high' | 'default' | 'low' | 'min';

interface NotifyEvent {
  type: 'permission_request' | 'ask_user_question' | 'run_completed' | 'run_failed' | 'background_permission';
  title: string;
  body: string;
  priority?: NtfyPriority;
  tags?: string[];
  clickUrl?: string;
}

export class NotificationService {
  private db: Database.Database;
  private configCache: NotificationConfig | null = null;

  constructor(db: Database.Database) {
    this.db = db;
  }

  getConfig(): NotificationConfig {
    if (this.configCache) return this.configCache;

    const row = this.db.prepare(
      'SELECT config FROM notification_config WHERE id = ?'
    ).get('default') as { config: string } | undefined;

    if (row) {
      try {
        this.configCache = JSON.parse(row.config);
        return this.configCache!;
      } catch {
        // Fall through to default
      }
    }

    return DEFAULT_NOTIFICATION_CONFIG;
  }

  saveConfig(config: NotificationConfig): void {
    this.db.prepare(`
      INSERT INTO notification_config (id, config, updated_at)
      VALUES ('default', ?, ?)
      ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at
    `).run(JSON.stringify(config), Date.now());

    this.configCache = config;
  }

  async notify(event: NotifyEvent): Promise<void> {
    const config = this.getConfig();
    if (!config.enabled || !config.ntfyTopic) return;

    // Check if this event type is enabled
    const eventKeyMap: Record<NotifyEvent['type'], keyof NotificationConfig['events']> = {
      permission_request: 'permissionRequest',
      ask_user_question: 'askUserQuestion',
      run_completed: 'runCompleted',
      run_failed: 'runFailed',
      background_permission: 'backgroundPermission',
    };

    const eventKey = eventKeyMap[event.type];
    if (!config.events[eventKey]) return;

    const url = `${config.ntfyUrl.replace(/\/$/, '')}/${config.ntfyTopic}`;

    const headers: Record<string, string> = {
      'Title': event.title,
      'Priority': event.priority || 'default',
    };

    if (event.tags && event.tags.length > 0) {
      headers['Tags'] = event.tags.join(',');
    }

    if (event.clickUrl) {
      headers['Click'] = event.clickUrl;
    }

    try {
      await fetch(url, {
        method: 'POST',
        headers,
        body: event.body,
      });
    } catch (err) {
      // Log but don't throw — notification failures shouldn't break the main flow
      console.error('[Notification] Failed to send ntfy notification:', err);
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
        'Title': 'MyClaudia - Test Notification',
        'Priority': 'default',
        'Tags': 'white_check_mark',
      },
      body: 'If you see this, notifications are working!',
    });

    if (!response.ok) {
      throw new Error(`ntfy returned ${response.status}: ${response.statusText}`);
    }
  }
}
