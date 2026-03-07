/**
 * Plugin Store - Zustand store for plugin UI state
 *
 * This store manages the UI state for the plugin system, including:
 * - Installed plugins list
 * - Active plugin states
 * - UI extension registrations (panels, settings tabs)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PluginManifest } from '@my-claudia/shared';

// ============================================
// Types
// ============================================

export type PluginStatus = 'idle' | 'loading' | 'active' | 'error' | 'disabled';

export interface InstalledPlugin {
  manifest: PluginManifest;
  path: string;
  status: PluginStatus;
  error?: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

export interface UIExtension {
  id: string;
  pluginId: string;
  type: 'panel' | 'settings-tab' | 'toolbar' | 'status-bar';
  location?: string;
  label: string;
  icon?: string;
  component?: unknown; // React component
  order?: number;
}

export interface PluginSettings {
  [pluginId: string]: Record<string, unknown>;
}

interface PluginStoreState {
  // Plugin list
  plugins: InstalledPlugin[];
  isLoading: boolean;
  error: string | null;

  // UI Extensions
  panels: UIExtension[];
  settingsTabs: UIExtension[];
  toolbarItems: UIExtension[];

  // Plugin settings
  settings: PluginSettings;

  // Actions - Plugins
  setPlugins: (plugins: InstalledPlugin[]) => void;
  addPlugin: (plugin: InstalledPlugin) => void;
  updatePlugin: (pluginId: string, updates: Partial<InstalledPlugin>) => void;
  removePlugin: (pluginId: string) => void;
  setPluginStatus: (pluginId: string, status: PluginStatus) => void;
  togglePlugin: (pluginId: string) => void;

  // Actions - UI Extensions
  registerPanel: (extension: UIExtension) => void;
  unregisterPanel: (id: string) => void;
  registerSettingsTab: (extension: UIExtension) => void;
  unregisterSettingsTab: (id: string) => void;
  registerToolbarItem: (extension: UIExtension) => void;
  unregisterToolbarItem: (id: string) => void;
  clearPluginExtensions: (pluginId: string) => void;

  // Actions - Settings
  setPluginSetting: (pluginId: string, key: string, value: unknown) => void;
  getPluginSetting: <T>(pluginId: string, key: string, defaultValue: T) => T;
  clearPluginSettings: (pluginId: string) => void;

  // Actions - Loading
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

// ============================================
// Store
// ============================================

export const usePluginStore = create<PluginStoreState>()(
  persist(
    (set, get) => ({
      // Initial state
      plugins: [],
      isLoading: false,
      error: null,
      panels: [],
      settingsTabs: [],
      toolbarItems: [],
      settings: {},

      // Plugin Actions
      setPlugins: (plugins) => set({ plugins }),

      addPlugin: (plugin) =>
        set((state) => ({
          plugins: [...state.plugins.filter((p) => p.manifest.id !== plugin.manifest.id), plugin],
        })),

      updatePlugin: (pluginId, updates) =>
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.manifest.id === pluginId ? { ...p, ...updates } : p
          ),
        })),

      removePlugin: (pluginId) =>
        set((state) => ({
          plugins: state.plugins.filter((p) => p.manifest.id !== pluginId),
        })),

      setPluginStatus: (pluginId, status) =>
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.manifest.id === pluginId ? { ...p, status } : p
          ),
        })),

      togglePlugin: (pluginId) =>
        set((state) => ({
          plugins: state.plugins.map((p) =>
            p.manifest.id === pluginId ? { ...p, enabled: !p.enabled } : p
          ),
        })),

      // UI Extension Actions
      registerPanel: (extension) =>
        set((state) => ({
          panels: [...state.panels.filter((p) => p.id !== extension.id), extension],
        })),

      unregisterPanel: (id) =>
        set((state) => ({
          panels: state.panels.filter((p) => p.id !== id),
        })),

      registerSettingsTab: (extension) =>
        set((state) => ({
          settingsTabs: [...state.settingsTabs.filter((t) => t.id !== extension.id), extension],
        })),

      unregisterSettingsTab: (id) =>
        set((state) => ({
          settingsTabs: state.settingsTabs.filter((t) => t.id !== id),
        })),

      registerToolbarItem: (extension) =>
        set((state) => ({
          toolbarItems: [...state.toolbarItems.filter((t) => t.id !== extension.id), extension],
        })),

      unregisterToolbarItem: (id) =>
        set((state) => ({
          toolbarItems: state.toolbarItems.filter((t) => t.id !== id),
        })),

      clearPluginExtensions: (pluginId) =>
        set((state) => ({
          panels: state.panels.filter((p) => p.pluginId !== pluginId),
          settingsTabs: state.settingsTabs.filter((t) => t.pluginId !== pluginId),
          toolbarItems: state.toolbarItems.filter((t) => t.pluginId !== pluginId),
        })),

      // Settings Actions
      setPluginSetting: (pluginId, key, value) =>
        set((state) => ({
          settings: {
            ...state.settings,
            [pluginId]: {
              ...(state.settings[pluginId] || {}),
              [key]: value,
            },
          },
        })),

      getPluginSetting: <T>(pluginId: string, key: string, defaultValue: T): T => {
        const state = get();
        const pluginSettings = state.settings[pluginId];
        if (pluginSettings && key in pluginSettings) {
          return pluginSettings[key] as T;
        }
        return defaultValue;
      },

      clearPluginSettings: (pluginId) =>
        set((state) => {
          const { [pluginId]: _, ...rest } = state.settings;
          return { settings: rest };
        }),

      // Loading Actions
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'claudia-plugin-store',
      partialize: (state) => ({
        // Only persist these fields
        settings: state.settings,
      }),
    }
  )
);

// ============================================
// Selectors
// ============================================

export const selectActivePlugins = (state: PluginStoreState): InstalledPlugin[] =>
  state.plugins.filter((p) => p.status === 'active' && p.enabled);

export const selectPluginById = (pluginId: string) => (state: PluginStoreState): InstalledPlugin | undefined =>
  state.plugins.find((p) => p.manifest.id === pluginId);

export const selectPluginPanels = (state: PluginStoreState): UIExtension[] =>
  state.panels.sort((a, b) => (a.order || 0) - (b.order || 0));

export const selectPluginSettingsTabs = (state: PluginStoreState): UIExtension[] =>
  state.settingsTabs.sort((a, b) => (a.order || 0) - (b.order || 0));
