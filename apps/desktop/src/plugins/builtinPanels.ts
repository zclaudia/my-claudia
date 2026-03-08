/**
 * Builtin Plugin Panels
 *
 * Registers frontend React components for built-in server plugins.
 * Called once on app startup so plugin commands that trigger showPanel()
 * have a component ready to render in the bottom panel area.
 */
import { usePluginStore } from '../stores/pluginStore';
import { SystemMonitorPanel } from '../components/plugins/SystemMonitorPanel';
import { NotesBoardPanel } from '../components/plugins/NotesBoardPanel';

export function initBuiltinPanels() {
  const { registerPanel } = usePluginStore.getState();

  registerPanel({
    id: 'system-monitor',
    pluginId: 'com.claudia.system-monitor',
    type: 'panel',
    label: 'System Monitor',
    icon: 'Cpu',
    component: SystemMonitorPanel,
    order: 100,
  });

  registerPanel({
    id: 'notes-board',
    pluginId: 'com.claudia.notes-board',
    type: 'panel',
    label: 'Notes Board',
    icon: 'StickyNote',
    component: NotesBoardPanel,
    order: 101,
  });
}
