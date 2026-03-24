import type { NotificationConfig } from '@my-claudia/shared';
import { apiCall, apiCallVoid } from './unwrap';

export async function getNotificationConfig(): Promise<NotificationConfig> {
  return apiCall<NotificationConfig>('/api/notifications/config');
}

export async function updateNotificationConfig(config: NotificationConfig): Promise<void> {
  return apiCallVoid('/api/notifications/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function sendTestNotification(): Promise<void> {
  return apiCallVoid('/api/notifications/test', { method: 'POST' });
}
