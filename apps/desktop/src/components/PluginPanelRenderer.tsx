/**
 * Plugin Panel Renderer
 *
 * Renders plugin-registered panels in the bottom panel area.
 * Supports two panel types:
 *   - React component panels (builtin plugins, registered via builtinPanels.ts)
 *   - Iframe panels (third-party plugins, served from /api/plugins/:id/frontend/*)
 *
 * Theme synchronization:
 *   - On iframe load, sends `claudia:init` with current theme classes + CSS vars
 *   - MutationObserver watches <html> class changes and sends `claudia:theme-changed`
 */

import { useEffect, useRef } from 'react';
import { usePluginStore, selectPluginPanels } from '../stores/pluginStore';
import { useServerStore } from '../stores/serverStore';

interface PluginPanelRendererProps {
  activePluginPanelId: string | null;
  projectRoot?: string;
  projectId?: string;
}

/** postMessage protocol version. Increment only on breaking schema changes. */
const PROTOCOL_VERSION = 1;

// CSS variable names to collect and forward to plugin iframes
const THEME_CSS_VARS = [
  '--background', '--foreground',
  '--card', '--card-foreground',
  '--popover', '--popover-foreground',
  '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground',
  '--accent', '--accent-foreground',
  '--destructive', '--destructive-foreground',
  '--success', '--success-foreground',
  '--warning', '--warning-foreground',
  '--thinking', '--thinking-foreground',
  '--border', '--input', '--ring', '--radius',
  '--scrollbar-thumb', '--scrollbar-thumb-hover',
  '--terminal-bg', '--terminal-fg', '--terminal-cursor', '--terminal-selection',
];

function collectCSSVars(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const v of THEME_CSS_VARS) {
    const val = style.getPropertyValue(v).trim();
    if (val) vars[v] = val;
  }
  return vars;
}

function getThemeClasses(): string[] {
  return Array.from(document.documentElement.classList).filter(
    (c) => c === 'dark' || c.startsWith('dark-')
  );
}

// ── Iframe panel component with theme sync ──────────────────────────────────
function IframePanel({
  src,
  label,
  panelId,
  pluginId,
  serverUrl,
}: {
  src: string;
  label: string;
  panelId: string;
  pluginId: string;
  serverUrl: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  function sendTheme(type: 'claudia:init' | 'claudia:theme-changed') {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      {
        type,
        protocol: PROTOCOL_VERSION,
        panelId,
        pluginId,
        serverUrl,
        themeClasses: getThemeClasses(),
        cssVars: collectCSSVars(),
      },
      '*'
    );
  }

  useEffect(() => {
    // Listen for ready signal from the iframe
    function onMessage(event: MessageEvent) {
      if (event.data?.type === 'claudia:ready') {
        sendTheme('claudia:init');
      }
    }
    window.addEventListener('message', onMessage);

    // Watch for theme class changes on <html>
    const observer = new MutationObserver(() => {
      sendTheme('claudia:theme-changed');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      window.removeEventListener('message', onMessage);
      observer.disconnect();
    };
  });

  return (
    <div className="absolute inset-0">
      <iframe
        ref={iframeRef}
        src={src}
        className="w-full h-full border-none"
        sandbox="allow-scripts allow-same-origin allow-forms"
        title={label}
        onLoad={() => sendTheme('claudia:init')}
      />
    </div>
  );
}

// ── Main renderer ───────────────────────────────────────────────────────────
export function PluginPanelRenderer({
  activePluginPanelId,
  projectRoot,
  projectId,
}: PluginPanelRendererProps) {
  const panels = usePluginStore(selectPluginPanels);
  const activePanel = panels.find((p) => p.id === activePluginPanelId);

  if (!activePanel) return null;

  // ── Iframe panel (third-party plugins with frontend HTML) ──────────────────
  if (activePanel.iframeUrl) {
    const server = useServerStore.getState().getActiveServer?.();
    const address = server?.address || 'localhost:3100';
    const baseUrl = address.includes('://') ? address : `http://${address}`;
    const url = new URL(activePanel.iframeUrl, baseUrl);
    if (projectRoot) url.searchParams.set('projectRoot', projectRoot);
    if (projectId) url.searchParams.set('projectId', projectId);
    url.searchParams.set('panelId', activePanel.id);
    url.searchParams.set('pluginId', activePanel.pluginId);

    return (
      <IframePanel
        src={url.toString()}
        label={activePanel.label}
        panelId={activePanel.id}
        pluginId={activePanel.pluginId}
        serverUrl={baseUrl}
      />
    );
  }

  // ── React component panel (builtin plugins) ────────────────────────────────
  if (!activePanel.component) return null;

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
