// Push Notification Types (ntfy integration)

export interface NotificationEventPreferences {
  permissionRequest: boolean;
  promptRequest: boolean;
  runCompleted: boolean;
  runFailed: boolean;
  backgroundPermission: boolean;
  processLeak: boolean;
}

export type NotificationAuthMode = 'none' | 'bearer' | 'basic';

export interface NotificationConfig {
  enabled: boolean;
  ntfyUrl: string;
  ntfyTopic: string;
  ntfyAuthMode: NotificationAuthMode;
  ntfyPublishToken: string;
  ntfySubscribeToken: string;
  ntfyUsername: string;
  ntfyPassword: string;
  events: NotificationEventPreferences;
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: false,
  ntfyUrl: 'https://ntfy.sh',
  ntfyTopic: '',
  ntfyAuthMode: 'none',
  ntfyPublishToken: '',
  ntfySubscribeToken: '',
  ntfyUsername: '',
  ntfyPassword: '',
  events: {
    permissionRequest: true,
    promptRequest: true,
    runCompleted: true,
    runFailed: true,
    backgroundPermission: true,
    processLeak: true,
  },
};
