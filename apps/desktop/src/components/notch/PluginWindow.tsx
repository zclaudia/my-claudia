/**
 * PluginWindow — standalone window for plugin iframe panels.
 *
 * Loaded via query param: ?pluginWindow=<pluginId>&panelId=<panelId>
 * Renders the plugin's frontend HTML in a full-window iframe with theme sync.
 */

import { useEffect, useRef } from 'react';

// CSS variable names to forward (same as PluginPanelRenderer)
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
    (c) => c === 'dark' || c.startsWith('dark-'),
  );
}

interface PluginWindowProps {
  pluginId: string;
  params: URLSearchParams;
}

export function PluginWindow({ pluginId, params }: PluginWindowProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const panelId = params.get('panelId') || '';
  const serverUrl = params.get('serverUrl') || '';
  const authToken = params.get('authToken') || '';
  const rawIframeUrl = params.get('iframeUrl') || '';

  // Build iframe src URL
  const iframeSrc = rawIframeUrl
    ? new URL(rawIframeUrl, serverUrl).toString()
    : `${serverUrl}/api/plugins/${encodeURIComponent(pluginId)}/frontend/ui/index.html`;

  // Collect extra params to forward to the iframe
  const extraParams: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (!['pluginWindow', 'panelId', 'serverUrl', 'authToken', 'iframeUrl', 'serverId', 'serverName', 'gatewayUrl', 'gatewaySecret'].includes(key)) {
      extraParams[key] = value;
    }
  }

  function sendTheme(type: 'claudia:init' | 'claudia:theme-changed') {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      {
        type,
        protocol: 1,
        panelId,
        pluginId,
        serverUrl,
        authToken,
        windowMode: true,
        extraParams,
        themeClasses: getThemeClasses(),
        cssVars: collectCSSVars(),
      },
      '*',
    );
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.data?.type === 'claudia:ready') {
        sendTheme('claudia:init');
      }
    }
    window.addEventListener('message', onMessage);

    const observer = new MutationObserver(() => {
      sendTheme('claudia:theme-changed');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    // Emit close event when window is being closed
    const handleBeforeUnload = async () => {
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('plugin-window-closed', { pluginId, panelId });
      } catch {
        // Not in Tauri environment
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, panelId]);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        sandbox="allow-scripts allow-same-origin allow-forms"
        title={`Plugin: ${pluginId}`}
        onLoad={() => sendTheme('claudia:init')}
      />
    </div>
  );
}
