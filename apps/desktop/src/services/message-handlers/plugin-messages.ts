/**
 * Plugin lifecycle message handlers.
 */
import type { ServerMessage } from '@my-claudia/shared';
import { usePluginStore } from '../../stores/pluginStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { resolveCanonicalBackendId, resolveLocalBackendId } from '../../utils/controlPlane';
import { parseBackendId } from '../../stores/gatewayStore';

function resolveOwnerBackendId(backendId: string | null, serverId: string): string {
  const rawBackendId = backendId || parseBackendId(serverId) || serverId;
  return resolveCanonicalBackendId(rawBackendId, resolveLocalBackendId() ?? rawBackendId) ?? rawBackendId;
}

export function handlePluginMessage(
  msg: ServerMessage,
  serverId: string,
  backendId: string | null,
): boolean {
  switch (msg.type) {
    case 'plugin_state': {
      const pluginStore = usePluginStore.getState();
      const now = new Date().toISOString();
      pluginStore.setPlugins(msg.plugins.map((p: any) => ({
        manifest: {
          id: p.id,
          name: p.name,
          version: p.version,
          description: p.description,
          permissions: p.permissions,
          platform: p.platform,
        },
        path: p.path,
        status: p.status === 'active' ? 'active' : p.status === 'error' ? 'error' : 'idle',
        enabled: p.enabled,
        error: p.error,
        installedAt: now,
        updatedAt: now,
      })));

      for (const p of msg.plugins as any[]) {
        if (p.status === 'active' && p.panels?.length > 0) {
          for (const panel of p.panels) {
            const existing = pluginStore.panels.find((ep: any) => ep.id === panel.id);
            if (!existing) {
              pluginStore.registerPanel({
                id: panel.id,
                pluginId: p.id,
                type: 'panel',
                label: panel.label,
                icon: panel.icon,
                iframeUrl: panel.iframeUrl,
                order: panel.order,
                visible: false,
              });
            }
          }
        }
        // Register notch tabs from plugin_state
        if (p.status === 'active' && p.notchTabs?.length > 0) {
          for (const tab of p.notchTabs) {
            const existing = pluginStore.notchTabs.find((t: any) => t.id === tab.id);
            if (!existing) {
              pluginStore.registerNotchTab({
                id: tab.id,
                pluginId: tab.pluginId ?? p.id,
                label: tab.label,
                icon: tab.icon,
                order: tab.order ?? 0,
              });
            }
          }
        }
      }
      return true;
    }

    case 'plugin_permission_request': {
      const pluginStoreForPerms = usePluginStore.getState();
      pluginStoreForPerms.setPendingPermissionRequest({
        pluginId: (msg as any).pluginId,
        pluginName: (msg as any).pluginName,
        permissions: (msg as any).permissions,
      });
      return true;
    }

    case 'plugin_notification': {
      const pluginMsg = msg as import('@my-claudia/shared').PluginNotificationMessage;
      import('../../stores/notificationFeedStore').then(m => m.useNotificationFeedStore.getState().upsertItem({
        id: `plugin-${pluginMsg.pluginId}-${Date.now()}`,
        ownerBackendId: resolveOwnerBackendId(backendId, serverId),
        source: 'trigger',
        title: pluginMsg.title,
        summary: pluginMsg.body,
        status: 'completed',
        pluginTab: pluginMsg.notchTab,
        createdAt: Date.now(),
      }));
      import('../../stores/toastStore').then(m => {
        m.useToastStore.getState().add({
          title: pluginMsg.title,
          message: pluginMsg.body,
          type: 'info',
          icon: 'system',
          serverId,
          pluginTab: pluginMsg.notchTab,
        });
      });
      return true;
    }

    case 'plugin_show_panel':
      usePluginStore.getState().updatePanelVisibility(msg.panelId, true);
      useBottomPanelStore.getState().setActiveTab(msg.panelId);
      return true;

    case 'plugin_panel_registered':
      usePluginStore.getState().registerPanel({
        id: msg.panelId,
        pluginId: msg.pluginId,
        type: 'panel',
        label: msg.label,
        icon: msg.icon,
        iframeUrl: msg.iframeUrl,
        order: msg.order,
        visible: false,
      });
      return true;

    case 'plugin_panel_unregistered':
      usePluginStore.getState().clearPluginExtensions(msg.pluginId);
      return true;

    case 'plugin_notch_tab_registered':
      usePluginStore.getState().registerNotchTab({
        id: msg.tabId,
        pluginId: msg.pluginId,
        label: msg.label,
        icon: msg.icon,
        order: msg.order ?? 0,
      });
      return true;

    case 'plugin_notch_tab_unregistered':
      usePluginStore.getState().unregisterNotchTabs(msg.pluginId);
      return true;

    default:
      return false;
  }
}
