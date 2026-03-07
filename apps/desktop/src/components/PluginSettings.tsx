/**
 * Plugin Settings Component
 *
 * Displays the plugin management UI in settings.
 * Shows installed plugins, allows enable/disable, and shows plugin settings tabs.
 */

import { useState, useCallback } from 'react';
import { usePluginStore } from '../stores/pluginStore';
import type { InstalledPlugin, PluginStatus } from '../stores/pluginStore';
import { getBaseUrl } from '../services/api';

// Status badge colors
const statusColors: Record<PluginStatus, string> = {
  idle: 'bg-gray-500/20 text-gray-400',
  loading: 'bg-blue-500/20 text-blue-400',
  active: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400',
  disabled: 'bg-gray-500/20 text-gray-500',
};

const statusLabels: Record<PluginStatus, string> = {
  idle: 'Idle',
  loading: 'Loading...',
  active: 'Active',
  error: 'Error',
  disabled: 'Disabled',
};

interface PluginSettingsProps {
  onOpenPluginSettings?: (pluginId: string) => void;
}

export function PluginSettings({ onOpenPluginSettings }: PluginSettingsProps) {
  const {
    plugins,
    isLoading,
    error,
    removePlugin,
    setError,
  } = usePluginStore();

  const [searchQuery, setSearchQuery] = useState('');

  const togglePlugin = useCallback(async (pluginId: string) => {
    const plugin = plugins.find(p => p.manifest.id === pluginId);
    if (!plugin) return;

    try {
      const action = plugin.status === 'active' ? 'deactivate' : 'activate';
      const baseUrl = getBaseUrl();
      const res = await fetch(`${baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error?.message || `Failed to ${action} plugin`);
      }
      // Server will broadcast updated plugin_state via WebSocket
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle plugin');
    }
  }, [plugins, setError]);

  // Filter plugins by search query
  const filteredPlugins = plugins.filter((plugin) =>
    plugin.manifest.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    plugin.manifest.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    plugin.manifest.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group plugins by status
  const activePlugins = filteredPlugins.filter((p) => p.status === 'active' && p.enabled);
  const inactivePlugins = filteredPlugins.filter((p) => p.status !== 'active' || !p.enabled);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        <span className="ml-2 text-muted-foreground">Loading plugins...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => setError(null)}
          className="mt-2 text-xs text-red-400 hover:text-red-300"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search plugins..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-secondary/50 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-foreground">{plugins.length}</div>
          <div className="text-xs text-muted-foreground">Total</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-green-400">{activePlugins.length}</div>
          <div className="text-xs text-muted-foreground">Active</div>
        </div>
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="text-2xl font-bold text-muted-foreground">{inactivePlugins.length}</div>
          <div className="text-xs text-muted-foreground">Inactive</div>
        </div>
      </div>

      {/* Plugin List */}
      {plugins.length === 0 ? (
        <div className="text-center py-8">
          <svg
            className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <p className="text-muted-foreground text-sm">No plugins installed</p>
          <p className="text-muted-foreground/70 text-xs mt-1">
            Plugins will appear here when installed
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Active Plugins */}
          {activePlugins.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Active ({activePlugins.length})
              </h4>
              <div className="space-y-2">
                {activePlugins.map((plugin) => (
                  <PluginCard
                    key={plugin.manifest.id}
                    plugin={plugin}
                    onToggle={togglePlugin}
                    onRemove={removePlugin}
                    onOpenSettings={onOpenPluginSettings}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Inactive Plugins */}
          {inactivePlugins.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Inactive ({inactivePlugins.length})
              </h4>
              <div className="space-y-2">
                {inactivePlugins.map((plugin) => (
                  <PluginCard
                    key={plugin.manifest.id}
                    plugin={plugin}
                    onToggle={togglePlugin}
                    onRemove={removePlugin}
                    onOpenSettings={onOpenPluginSettings}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Individual plugin card
interface PluginCardProps {
  plugin: InstalledPlugin;
  onToggle: (pluginId: string) => void;
  onRemove: (pluginId: string) => void;
  onOpenSettings?: (pluginId: string) => void;
}

function PluginCard({ plugin, onToggle, onRemove, onOpenSettings }: PluginCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleRemove = () => {
    if (showConfirm) {
      onRemove(plugin.manifest.id);
      setShowConfirm(false);
    } else {
      setShowConfirm(true);
      // Auto-hide after 3 seconds
      setTimeout(() => setShowConfirm(false), 3000);
    }
  };

  return (
    <div className="p-3 bg-secondary/50 rounded-lg border border-border/50 hover:border-border transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{plugin.manifest.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColors[plugin.status]}`}>
              {statusLabels[plugin.status]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {plugin.manifest.description}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              {plugin.manifest.id}
            </span>
            <span className="text-[10px] text-muted-foreground/70">v{plugin.manifest.version}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Enable/Disable Toggle */}
          <button
            onClick={() => onToggle(plugin.manifest.id)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              plugin.enabled ? 'bg-primary' : 'bg-secondary'
            }`}
            title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                plugin.enabled ? 'left-5' : 'left-0.5'
              }`}
            />
          </button>

          {/* Settings Button */}
          {plugin.manifest.contributes?.settings && (
            <button
              onClick={() => onOpenSettings?.(plugin.manifest.id)}
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Plugin settings"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}

          {/* Remove Button */}
          <button
            onClick={handleRemove}
            className={`p-1.5 rounded transition-colors ${
              showConfirm
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'hover:bg-secondary text-muted-foreground hover:text-red-400'
            }`}
            title={showConfirm ? 'Click again to confirm' : 'Remove plugin'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Permissions */}
      {plugin.manifest.permissions && plugin.manifest.permissions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {plugin.manifest.permissions.map((perm) => (
            <span
              key={perm}
              className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/10 text-yellow-500/80 font-mono"
            >
              {perm}
            </span>
          ))}
        </div>
      )}

      {/* Error Message */}
      {plugin.error && (
        <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-red-400">
          {plugin.error}
        </div>
      )}
    </div>
  );
}

export default PluginSettings;
