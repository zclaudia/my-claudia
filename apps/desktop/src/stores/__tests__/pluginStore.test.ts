/**
 * Unit tests for PluginStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  usePluginStore,
  selectActivePlugins,
  selectPluginById,
  selectPluginPanels,
  selectPluginSettingsTabs,
  type InstalledPlugin,
  type UIExtension,
} from '../pluginStore';
import type { PluginManifest } from '@my-claudia/shared';

// Helper to create a test plugin
function createTestPlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  const manifest: PluginManifest = overrides.manifest || {
    id: 'com.test.plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
  };

  return {
    manifest,
    path: '/test/path',
    status: 'idle',
    enabled: true,
    installedAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('PluginStore', () => {
  beforeEach(() => {
    // Reset store
    usePluginStore.setState({
      plugins: [],
      isLoading: false,
      error: null,
      panels: [],
      settingsTabs: [],
      toolbarItems: [],
      settings: {},
    });
  });

  describe('plugin management', () => {
    it('should add a plugin', () => {
      const plugin = createTestPlugin();

      usePluginStore.getState().addPlugin(plugin);

      expect(usePluginStore.getState().plugins).toHaveLength(1);
      expect(usePluginStore.getState().plugins[0].manifest.id).toBe('com.test.plugin');
    });

    it('should update an existing plugin when adding', () => {
      const plugin1 = createTestPlugin({ status: 'idle' });
      const plugin2 = createTestPlugin({ status: 'active' });

      usePluginStore.getState().addPlugin(plugin1);
      usePluginStore.getState().addPlugin(plugin2);

      expect(usePluginStore.getState().plugins).toHaveLength(1);
      expect(usePluginStore.getState().plugins[0].status).toBe('active');
    });

    it('should update a plugin', () => {
      const plugin = createTestPlugin();
      usePluginStore.getState().addPlugin(plugin);

      usePluginStore.getState().updatePlugin('com.test.plugin', { status: 'active', error: 'test error' });

      const updated = usePluginStore.getState().plugins[0];
      expect(updated.status).toBe('active');
      expect(updated.error).toBe('test error');
    });

    it('should remove a plugin', () => {
      const plugin = createTestPlugin();
      usePluginStore.getState().addPlugin(plugin);

      usePluginStore.getState().removePlugin('com.test.plugin');

      expect(usePluginStore.getState().plugins).toHaveLength(0);
    });

    it('should set plugin status', () => {
      const plugin = createTestPlugin();
      usePluginStore.getState().addPlugin(plugin);

      usePluginStore.getState().setPluginStatus('com.test.plugin', 'loading');

      expect(usePluginStore.getState().plugins[0].status).toBe('loading');
    });

    it('should toggle plugin enabled state', () => {
      const plugin = createTestPlugin({ enabled: true });
      usePluginStore.getState().addPlugin(plugin);

      usePluginStore.getState().togglePlugin('com.test.plugin');
      expect(usePluginStore.getState().plugins[0].enabled).toBe(false);

      usePluginStore.getState().togglePlugin('com.test.plugin');
      expect(usePluginStore.getState().plugins[0].enabled).toBe(true);
    });
  });

  describe('UI extensions', () => {
    it('should register a panel', () => {
      const extension: UIExtension = {
        id: 'panel-1',
        pluginId: 'com.test.plugin',
        type: 'panel',
        label: 'Test Panel',
      };

      usePluginStore.getState().registerPanel(extension);

      expect(usePluginStore.getState().panels).toHaveLength(1);
      expect(usePluginStore.getState().panels[0].id).toBe('panel-1');
    });

    it('should unregister a panel', () => {
      const extension: UIExtension = {
        id: 'panel-1',
        pluginId: 'com.test.plugin',
        type: 'panel',
        label: 'Test Panel',
      };

      usePluginStore.getState().registerPanel(extension);
      usePluginStore.getState().unregisterPanel('panel-1');

      expect(usePluginStore.getState().panels).toHaveLength(0);
    });

    it('should register a settings tab', () => {
      const extension: UIExtension = {
        id: 'settings-1',
        pluginId: 'com.test.plugin',
        type: 'settings-tab',
        label: 'Test Settings',
      };

      usePluginStore.getState().registerSettingsTab(extension);

      expect(usePluginStore.getState().settingsTabs).toHaveLength(1);
    });

    it('should clear all extensions for a plugin', () => {
      const panel: UIExtension = {
        id: 'panel-1',
        pluginId: 'com.test.plugin',
        type: 'panel',
        label: 'Test Panel',
      };
      const settingsTab: UIExtension = {
        id: 'settings-1',
        pluginId: 'com.test.plugin',
        type: 'settings-tab',
        label: 'Test Settings',
      };

      usePluginStore.getState().registerPanel(panel);
      usePluginStore.getState().registerSettingsTab(settingsTab);

      usePluginStore.getState().clearPluginExtensions('com.test.plugin');

      expect(usePluginStore.getState().panels).toHaveLength(0);
      expect(usePluginStore.getState().settingsTabs).toHaveLength(0);
    });
  });

  describe('settings', () => {
    it('should set a plugin setting', () => {
      usePluginStore.getState().setPluginSetting('com.test.plugin', 'theme', 'dark');

      expect(usePluginStore.getState().settings['com.test.plugin']['theme']).toBe('dark');
    });

    it('should get a plugin setting with default', () => {
      const value = usePluginStore.getState().getPluginSetting('com.test.plugin', 'theme', 'light');
      expect(value).toBe('light');

      usePluginStore.getState().setPluginSetting('com.test.plugin', 'theme', 'dark');
      const storedValue = usePluginStore.getState().getPluginSetting('com.test.plugin', 'theme', 'light');
      expect(storedValue).toBe('dark');
    });

    it('should clear plugin settings', () => {
      usePluginStore.getState().setPluginSetting('com.test.plugin', 'key1', 'value1');
      usePluginStore.getState().setPluginSetting('com.test.plugin2', 'key2', 'value2');

      usePluginStore.getState().clearPluginSettings('com.test.plugin');

      expect(usePluginStore.getState().settings['com.test.plugin']).toBeUndefined();
      expect(usePluginStore.getState().settings['com.test.plugin2']).toBeDefined();
    });
  });

  describe('loading state', () => {
    it('should set loading state', () => {
      usePluginStore.getState().setLoading(true);
      expect(usePluginStore.getState().isLoading).toBe(true);

      usePluginStore.getState().setLoading(false);
      expect(usePluginStore.getState().isLoading).toBe(false);
    });

    it('should set error state', () => {
      usePluginStore.getState().setError('Test error');
      expect(usePluginStore.getState().error).toBe('Test error');

      usePluginStore.getState().setError(null);
      expect(usePluginStore.getState().error).toBeNull();
    });
  });

  describe('selectors', () => {
    it('should select active plugins', () => {
      const plugin1 = createTestPlugin({ manifest: { id: 'plugin1', name: 'P1', version: '1.0', description: '' }, status: 'active', enabled: true });
      const plugin2 = createTestPlugin({ manifest: { id: 'plugin2', name: 'P2', version: '1.0', description: '' }, status: 'idle', enabled: true });
      const plugin3 = createTestPlugin({ manifest: { id: 'plugin3', name: 'P3', version: '1.0', description: '' }, status: 'active', enabled: false });

      usePluginStore.getState().setPlugins([plugin1, plugin2, plugin3]);

      const active = selectActivePlugins(usePluginStore.getState());
      expect(active).toHaveLength(1);
      expect(active[0].manifest.id).toBe('plugin1');
    });

    it('should select plugin by id', () => {
      const plugin = createTestPlugin();
      usePluginStore.getState().addPlugin(plugin);

      const found = selectPluginById('com.test.plugin')(usePluginStore.getState());
      expect(found).toBeDefined();
      expect(found?.manifest.id).toBe('com.test.plugin');

      const notFound = selectPluginById('nonexistent')(usePluginStore.getState());
      expect(notFound).toBeUndefined();
    });

    it('should select panels sorted by order', () => {
      const panel1: UIExtension = { id: 'panel-1', pluginId: 'p1', type: 'panel', label: 'Panel 1', order: 2 };
      const panel2: UIExtension = { id: 'panel-2', pluginId: 'p1', type: 'panel', label: 'Panel 2', order: 1 };

      usePluginStore.getState().registerPanel(panel1);
      usePluginStore.getState().registerPanel(panel2);

      const panels = selectPluginPanels(usePluginStore.getState());
      expect(panels[0].id).toBe('panel-2');
      expect(panels[1].id).toBe('panel-1');
    });

    it('should select settings tabs sorted by order', () => {
      const tab1: UIExtension = { id: 'tab-1', pluginId: 'p1', type: 'settings-tab', label: 'Tab 1', order: 3 };
      const tab2: UIExtension = { id: 'tab-2', pluginId: 'p1', type: 'settings-tab', label: 'Tab 2', order: 1 };

      usePluginStore.getState().registerSettingsTab(tab1);
      usePluginStore.getState().registerSettingsTab(tab2);

      const tabs = selectPluginSettingsTabs(usePluginStore.getState());
      expect(tabs[0].id).toBe('tab-2');
      expect(tabs[1].id).toBe('tab-1');
    });
  });

  describe('toolbar items', () => {
    it('should register a toolbar item', () => {
      const item: UIExtension = { id: 'toolbar-1', pluginId: 'com.test.plugin', type: 'toolbar', label: 'Action' };
      usePluginStore.getState().registerToolbarItem(item);
      expect(usePluginStore.getState().toolbarItems).toHaveLength(1);
    });

    it('should unregister a toolbar item', () => {
      const item: UIExtension = { id: 'toolbar-1', pluginId: 'com.test.plugin', type: 'toolbar', label: 'Action' };
      usePluginStore.getState().registerToolbarItem(item);
      usePluginStore.getState().unregisterToolbarItem('toolbar-1');
      expect(usePluginStore.getState().toolbarItems).toHaveLength(0);
    });

    it('clearPluginExtensions removes toolbar items too', () => {
      const item: UIExtension = { id: 'toolbar-1', pluginId: 'com.test.plugin', type: 'toolbar', label: 'Action' };
      usePluginStore.getState().registerToolbarItem(item);
      usePluginStore.getState().clearPluginExtensions('com.test.plugin');
      expect(usePluginStore.getState().toolbarItems).toHaveLength(0);
    });
  });

  describe('permission request', () => {
    it('should set pending permission request', () => {
      const req = { pluginId: 'com.test.plugin', pluginName: 'Test', permissions: ['read', 'write'] };
      usePluginStore.getState().setPendingPermissionRequest(req);
      expect(usePluginStore.getState().pendingPermissionRequest).toEqual(req);
    });

    it('should clear pending permission request', () => {
      usePluginStore.getState().setPendingPermissionRequest({
        pluginId: 'com.test.plugin', pluginName: 'Test', permissions: ['read'],
      });
      usePluginStore.getState().setPendingPermissionRequest(null);
      expect(usePluginStore.getState().pendingPermissionRequest).toBeNull();
    });
  });

  describe('unregisterSettingsTab', () => {
    it('should remove a settings tab by id', () => {
      const tab: UIExtension = { id: 'tab-1', pluginId: 'com.test.plugin', type: 'settings-tab', label: 'Tab' };
      usePluginStore.getState().registerSettingsTab(tab);
      usePluginStore.getState().unregisterSettingsTab('tab-1');
      expect(usePluginStore.getState().settingsTabs).toHaveLength(0);
    });
  });
});
