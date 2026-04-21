/**
 * Plugin Dock — fixed area in header for third-party plugin windows.
 * Max 5 buttons, scrollable.
 */
import { useMemo } from 'react';
import { Bot, MessageSquare, Activity, Clock, Cloud, Gauge, StickyNote, Puzzle, type LucideIcon } from 'lucide-react';
import { usePluginStore, selectPluginPanels } from '../stores/pluginStore';
import { useServerStore } from '../stores/serverStore';
import { isDesktopTauri } from '../utils/platform';

// Icon name → Lucide component mapping for plugin-declared icons.
const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  MessageSquare, Activity, Clock, Cloud, Gauge, StickyNote, Puzzle, Bot,
};

export function PluginIcon({ name, pluginId, size = 16 }: { name?: string; pluginId?: string; size?: number }) {
  const localServerPort = useServerStore(s => s.localServerPort);
  if (name && pluginId && /\.\w+$/.test(name)) {
    const baseUrl = `http://localhost:${localServerPort || 3100}`;
    const src = `${baseUrl}/api/plugins/${encodeURIComponent(pluginId)}/frontend/${name}`;
    return <img src={src} alt="" style={{ width: size, height: size }} className="object-contain" />;
  }
  const Icon = name ? PLUGIN_ICON_MAP[name] : undefined;
  if (Icon) return <Icon size={size} />;
  return <Puzzle size={size} />;
}

export function useActivePluginPanels() {
  const allPanels = usePluginStore(selectPluginPanels);
  const activeIds = usePluginStore(
    (s) => s.plugins.filter(p => p.status === 'active').map(p => p.manifest.id),
  );
  const activeIdsKey = useMemo(() => JSON.stringify(activeIds), [activeIds]);
  const activeSet = useMemo(() => new Set(JSON.parse(activeIdsKey)), [activeIdsKey]);
  return useMemo(
    () => allPanels.filter(p => p.iframeUrl && p.pluginId && activeSet.has(p.pluginId)),
    [allPanels, activeSet],
  );
}

export function PluginWindowButtons() {
  const pluginPanels = useActivePluginPanels();

  if (pluginPanels.length === 0 || !isDesktopTauri()) return null;

  const openWindow = async (panel: typeof pluginPanels[0]) => {
    try {
      const { openPluginWindow } = await import('../utils/pluginWindow');
      await openPluginWindow({
        pluginId: panel.pluginId,
        panelId: panel.id,
        title: panel.label || 'Plugin',
        width: 900,
        height: 650,
        iframeUrl: panel.iframeUrl,
      });
    } catch (err) {
      console.error('Failed to open plugin window:', err);
    }
  };

  return (
    <div className="flex items-center mr-1.5">
      <div className="w-px h-4 bg-border mr-1.5" />

      <div
        className="flex items-center gap-0.5 overflow-x-auto scrollbar-none"
        style={{ maxWidth: 5 * 32 }}
      >
        {pluginPanels.map(panel => (
          <button
            key={panel.id}
            onClick={() => openWindow(panel)}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-all"
            title={panel.label}
          >
            <PluginIcon name={panel.icon} pluginId={panel.pluginId} size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
