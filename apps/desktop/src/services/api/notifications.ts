import type { NotificationConfig } from '@my-claudia/shared';
import { fetchApi } from './base';

export async function getNotificationConfig(): Promise<NotificationConfig> {
  const result = await fetchApi<NotificationConfig>('/api/notifications/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get notification config');
  }
  return result.data;
}

export async function updateNotificationConfig(config: NotificationConfig): Promise<void> {
  const result = await fetchApi<void>('/api/notifications/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update notification config');
  }
}

export async function sendTestNotification(): Promise<void> {
  const result = await fetchApi<{ message: string }>('/api/notifications/test', {
    method: 'POST',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to send test notification');
  }
}
