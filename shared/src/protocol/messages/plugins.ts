// Plugin protocol messages

// Plugin state (Server → Client)
export interface PluginStateMessage {
  type: 'plugin_state';
  plugins: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    status: 'active' | 'inactive' | 'error';
    enabled: boolean;
    error?: string;
    permissions?: string[];
    grantedPermissions?: string[];
    tools?: string[];
    commands?: string[];
    path: string;
    /** Effective platform scope: 'universal' (backend-only) or 'desktop' (has UI) */
    platform: 'universal' | 'desktop';
    /** Capability requirements declared in manifest */
    requires?: import('../../plugin-types.js').PluginRequirements;
    /** Result of capability negotiation */
    capabilities?: import('../../plugin-types.js').CapabilityNegotiationResult;
  }>;
}

// Plugin notification (Server → Client)
export interface PluginNotificationMessage {
  type: 'plugin_notification';
  pluginId: string;
  title: string;
  body: string;
}

// Plugin show panel (Server → Client)
export interface PluginShowPanelMessage {
  type: 'plugin_show_panel';
  pluginId: string;
  panelId: string;
}

// Plugin panel registered (Server → Client) — sent when a plugin activates with panels
export interface PluginPanelRegisteredMessage {
  type: 'plugin_panel_registered';
  panelId: string;
  pluginId: string;
  label: string;
  icon?: string;
  iframeUrl?: string;
  order?: number;
}

// Plugin panel unregistered (Server → Client) — sent when a plugin deactivates
export interface PluginPanelUnregisteredMessage {
  type: 'plugin_panel_unregistered';
  pluginId: string;
}

// File Push notification (Server → Client)
export interface FilePushNotificationMessage {
  type: 'file_push';
  fileId: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description?: string;
  autoDownload: boolean;
  messageId?: string;
}
