// Push Notification Types (ntfy integration)

export interface NotificationEventPreferences {
  permissionRequest: boolean;
  promptRequest: boolean;
  runCompleted: boolean;
  runFailed: boolean;
  supervisionUpdate: boolean;
  backgroundPermission: boolean;
  processLeak: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  ntfyUrl: string;
  ntfyTopic: string;
  events: NotificationEventPreferences;
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: false,
  ntfyUrl: 'https://ntfy.sh',
  ntfyTopic: '',
  events: {
    permissionRequest: true,
    promptRequest: true,
    runCompleted: true,
    runFailed: true,
    supervisionUpdate: true,
    backgroundPermission: true,
    processLeak: true,
  },
};
