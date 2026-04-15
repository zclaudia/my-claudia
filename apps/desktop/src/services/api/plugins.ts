import type { Permission, PluginPlatform } from '@my-claudia/shared';
import { apiCall } from './unwrap';
import { usePluginStore } from '../../stores/pluginStore';
import type { InstalledPlugin } from '../../stores/pluginStore';

interface PluginData {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions?: string[];
  platform?: string;
  status: string;
  enabled: boolean;
  error?: string;
  path: string;
  panels?: Array<{
    id: string;
    label: string;
    icon?: string;
    iframeUrl?: string;
    order?: number;
  }>;
}

/**
 * Fetch plugins from the server and sync to pluginStore.
 * This is the primary mechanism for populating plugin state.
 */
export async function fetchAndSyncPlugins(options?: RequestInit): Promise<void> {
  const plugins = await apiCall<PluginData[]>('/api/plugins', options);
  const pluginStore = usePluginStore.getState();
  const now = new Date().toISOString();

  const mapped: InstalledPlugin[] = plugins.map((p) => ({
    manifest: {
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      permissions: p.permissions as Permission[] | undefined,
      platform: p.platform as PluginPlatform | undefined,
    },
    path: p.path,
    status: p.status === 'active' ? 'active' : p.status === 'error' ? 'error' : 'idle',
    enabled: p.enabled,
    error: p.error,
    installedAt: now,
    updatedAt: now,
  }));

  pluginStore.setPlugins(mapped);

  // Register panels from active plugins
  for (const p of plugins) {
    if (p.status === 'active' && p.panels?.length) {
      for (const panel of p.panels) {
        const existing = pluginStore.panels.find((ep) => ep.id === panel.id);
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
  }
}
