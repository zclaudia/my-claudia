import type { GatewayClient } from '../gateway/gateway-client.js';

export interface NotifyEvent {
  type: 'permission_request' | 'prompt_request' | 'run_completed' | 'run_failed' | 'background_permission' | 'process_leak';
  title: string;
  body: string;
  priority?: 'urgent' | 'high' | 'default' | 'low' | 'min';
  tags?: string[];
  clickUrl?: string;
}

export interface NotificationSender {
  notify(event: NotifyEvent): Promise<void>;
}

/** Sends push_notification_request to gateway for delivery. */
export class GatewayNotificationSender implements NotificationSender {
  constructor(private getGatewayClient: () => GatewayClient | null) {}

  async notify(event: NotifyEvent): Promise<void> {
    this.getGatewayClient()?.sendPushNotificationRequest(event);
  }
}

/** No-op sender when no gateway is configured. */
export class NoopNotificationSender implements NotificationSender {
  async notify(): Promise<void> { /* no-op */ }
}
