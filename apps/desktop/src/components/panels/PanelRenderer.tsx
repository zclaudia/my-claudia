import type { ComponentType } from 'react';
import type { UIExtension } from '../../stores/pluginStore';
import { PluginPanelRenderer } from '../notch/PluginPanelRenderer';

export interface PanelRenderProps {
  panel: UIExtension;
  projectId?: string;
  projectRoot?: string;
  workingDirectory?: string;
}

/** Renders either a plugin iframe panel or a built-in React panel component. */
export function PanelContent({ panel, projectId, projectRoot, workingDirectory }: PanelRenderProps) {
  if (panel.iframeUrl) {
    return (
      <PluginPanelRenderer
        activePluginPanelId={panel.id}
        projectRoot={projectRoot}
        projectId={projectId}
      />
    );
  }
  if (!panel.component) return null;
  const Component = panel.component as ComponentType<Record<string, unknown>>;
  return <Component projectId={projectId} projectRoot={projectRoot} workingDirectory={workingDirectory} panelId={panel.id} />;
}

export function PanelActions({ panel, projectId }: { panel: UIExtension; projectId?: string }) {
  if (!panel.actions) return null;
  const Actions = panel.actions as ComponentType<Record<string, unknown>>;
  return <Actions projectId={projectId} />;
}
