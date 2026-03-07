/**
 * Plugin Panel Renderer
 *
 * Renders plugin-registered panels in the bottom panel area.
 * Uses the pluginStore to get registered panels and their components.
 */

import { usePluginStore, selectPluginPanels } from '../stores/pluginStore';

interface PluginPanelRendererProps {
  activePluginPanelId: string | null;
  projectRoot?: string;
  projectId?: string;
}

export function PluginPanelRenderer({
  activePluginPanelId,
  projectRoot,
  projectId,
}: PluginPanelRendererProps) {
  const panels = usePluginStore(selectPluginPanels);

  // Find the active plugin panel
  const activePanel = panels.find((p) => p.id === activePluginPanelId);

  if (!activePanel || !activePanel.component) {
    return null;
  }

  // Render the plugin component
  // The component is stored as a React component type
  const PluginComponent = activePanel.component as React.ComponentType<{
    projectRoot?: string;
    projectId?: string;
    panelId: string;
  }>;

  return (
    <div className="absolute inset-0">
      <PluginComponent
        projectRoot={projectRoot}
        projectId={projectId}
        panelId={activePanel.id}
      />
    </div>
  );
}

/**
 * Hook to get plugin panel tabs for the bottom panel.
 * Returns an array of tab definitions for registered plugin panels.
 */
export function usePluginPanelTabs() {
  const panels = usePluginStore(selectPluginPanels);

  return panels.map((panel) => ({
    id: `plugin:${panel.id}`,
    label: panel.label,
    icon: panel.icon,
    pluginId: panel.pluginId,
  }));
}

export default PluginPanelRenderer;
