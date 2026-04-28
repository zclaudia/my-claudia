import { useEffect, useMemo, useState } from 'react';
import { useAgentConfigStore } from '../stores/agentConfigStore';

import { useFacadeStore } from '../stores/facadeStore';
import { useServerStore } from '../stores/serverStore';
import { useShortcutStore } from '../stores/shortcutStore';
import { useClaudiaStatus } from './useClaudiaStatus';
import { isDesktopTauri } from '../utils/platform';
import { LEGACY_LOCAL_SERVER_ID, resolveCanonicalBackendId, resolveLocalBackendId } from '../utils/controlPlane';

interface ClaudiaDesktopOptions {
  isMobile: boolean;
  controlPlaneState: string;
  claudiaContextProjectId: string | null;
}

/**
 * Manages Claudia floating ball window, global shortcut, and unread badge
 * sync on desktop. No-op on mobile.
 */
export function useClaudiaDesktop({
  isMobile,
  controlPlaneState,
  claudiaContextProjectId,
}: ClaudiaDesktopOptions) {
  const agentConfig = useAgentConfigStore((s) => s.config);
  const agentConfigLoaded = useAgentConfigStore((s) => s.hasLoaded);
  const loadAgentConfig = useAgentConfigStore((s) => s.loadConfig);
  const localServerPort = useServerStore((s) => s.localServerPort);
  const facadeLocalBackendId = useFacadeStore((s) => s.localBackendId);
  const localBackendId = facadeLocalBackendId || resolveLocalBackendId();
  const localBackendName = useFacadeStore((s) =>
    s.backends.find((backend) => backend.backendId === (s.localBackendId || resolveLocalBackendId()))?.name
  );
  const shortcut = useShortcutStore((s) => s.shortcut);
  const shortcutEnabled = useShortcutStore((s) => s.enabled);
  const { hasUnread: hasClaudiaUnread, hasRunning: hasClaudiaRunning, hasPermissionPending: hasClaudiaPermissionPending } = useClaudiaStatus();

  const [claudiaProjectId, setClaudiaProjectId] = useState<string | null>(null);

  // Don't send the context project if it's the same as the Claudia host project
  const resolvedContextProjectId = claudiaContextProjectId === claudiaProjectId ? null : claudiaContextProjectId;

  const claudiaServerUrl = useMemo(() => {
    return `http://localhost:${localServerPort || 3100}`;
  }, [localServerPort]);

  // Load agent config when control plane is ready
  useEffect(() => {
    if (controlPlaneState !== 'ready') return;
    void loadAgentConfig();
  }, [controlPlaneState, loadAgentConfig]);

  // Ensure Claudia host project exists
  useEffect(() => {
    if (controlPlaneState !== 'ready' || !agentConfigLoaded || !agentConfig?.enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const { ensureAgent } = await import('../services/api/servers');
        const ensured = await ensureAgent();
        if (!cancelled) {
          setClaudiaProjectId(ensured.projectId);
        }
      } catch (error) {
        console.warn('[App] Failed to ensure Claudia host project:', error);
      }
    })();

    return () => { cancelled = true; };
  }, [agentConfig?.enabled, agentConfigLoaded, controlPlaneState]);

  // Sync floating ball visibility with master toggle
  useEffect(() => {
    if (!isDesktopTauri() || isMobile || !agentConfigLoaded) return;
    (async () => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const { invoke } = await import('@tauri-apps/api/core');
        const { emit } = await import('@tauri-apps/api/event');
        const existing = await WebviewWindow.getByLabel('claudia-ball');
        const existingChat = await WebviewWindow.getByLabel('claudia-chat');

        if (!agentConfig?.enabled) {
          if (existingChat) await existingChat.hide().catch(() => undefined);
          if (existing) await existing.hide().catch(() => undefined);
          return;
        }

        if (!claudiaProjectId) return;

        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const authToken = '';
        const serverId = resolveCanonicalBackendId(localBackendId ?? LEGACY_LOCAL_SERVER_ID, localBackendId) || LEGACY_LOCAL_SERVER_ID;
        const serverName = localBackendName || 'Local Server';
        const hostWindow = getCurrentWindow();
        const scale = typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0
          ? window.devicePixelRatio
          : 1;
        const hostPos = await hostWindow.outerPosition().catch(() => null);
        const hostSize = await hostWindow.outerSize().catch(() => null);
        const hostX = hostPos ? hostPos.x / scale : window.screenX;
        const hostY = hostPos ? hostPos.y / scale : window.screenY;
        const hostWidth = hostSize ? hostSize.width / scale : window.outerWidth;
        const hostHeight = hostSize ? hostSize.height / scale : window.outerHeight;

        const ballParams = new URLSearchParams({
          claudiaBall: 'true',
          serverUrl: claudiaServerUrl,
          authToken,
          serverId,
          serverName,
        });
        if (claudiaProjectId) ballParams.set('projectId', claudiaProjectId);
        if (resolvedContextProjectId) ballParams.set('contextProjectId', resolvedContextProjectId);

        const chatParams = new URLSearchParams({ claudiaChat: 'true' });
        for (const key of ['serverUrl', 'authToken', 'serverId', 'serverName', 'gatewayUrl', 'gatewaySecret', 'projectId', 'contextProjectId'] as const) {
          const val = ballParams.get(key);
          if (val) chatParams.set(key, val);
        }

        if (!existing) {
          await invoke('create_claudia_ball', {
            ballUrl: `${window.location.origin}${window.location.pathname}?${ballParams}`,
            x: Math.max(16, Math.floor(hostX + hostWidth - 72)),
            y: Math.max(16, Math.floor(hostY + hostHeight - 96)),
          });
        } else {
          const chatVisible = existingChat
            ? await existingChat.isVisible().catch(() => false)
            : false;
          if (!chatVisible) await existing.show().catch(() => undefined);
        }

        void invoke('preload_claudia_chat', {
          chatUrl: `${window.location.origin}${window.location.pathname}?${chatParams}`,
        }).catch((preloadErr) => {
          console.warn('[App] Failed to preload Claudia chat window:', preloadErr);
        });

        await emit('claudia:context', {
          serverUrl: claudiaServerUrl,
          authToken,
          serverId,
          serverName,
          projectId: claudiaProjectId,
          contextProjectId: resolvedContextProjectId,
        });
      } catch (err) {
        console.warn('[App] Failed to create Claudia floating ball:', err);
      }
    })();
  }, [agentConfig?.enabled, agentConfigLoaded, resolvedContextProjectId, claudiaProjectId, claudiaServerUrl, isMobile, localBackendId, localBackendName]);

  // Sync global shortcut
  useEffect(() => {
    if (!isDesktopTauri() || isMobile || !agentConfigLoaded) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('update_global_shortcut', {
          shortcut: agentConfig?.enabled && shortcutEnabled ? shortcut : null,
        });
      } catch (err) {
        console.warn('[App] Failed to sync Claudia shortcut state:', err);
      }
    })();
  }, [agentConfig?.enabled, agentConfigLoaded, isMobile, shortcut, shortcutEnabled]);

  // Sync unread badge to floating ball
  useEffect(() => {
    if (!isDesktopTauri() || isMobile) return;
    (async () => {
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('claudia:unread', {
          unread: hasClaudiaUnread,
          running: hasClaudiaRunning,
          permissionPending: hasClaudiaPermissionPending,
        });
      } catch {
        // Ignore when Tauri event bridge is unavailable during startup.
      }
    })();
  }, [hasClaudiaPermissionPending, hasClaudiaUnread, hasClaudiaRunning, isMobile]);

  return { claudiaProjectId, agentConfig, agentConfigLoaded };
}
