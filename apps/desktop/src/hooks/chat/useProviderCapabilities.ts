import { useEffect, useMemo } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useChatStore } from '../../stores/chatStore';
import * as api from '../../services/api';
import type { ProviderCapabilities, SlashCommand } from '@my-claudia/shared';
import { LEGACY_LOCAL_SERVER_ID, resolveCanonicalBackendId } from '../../utils/controlPlane';

interface UseProviderCapabilitiesOptions {
  sessionId: string;
  isConnected: boolean;
}

export function useProviderCapabilities({ sessionId, isConnected }: UseProviderCapabilitiesOptions) {
  const {
    providerCommands,
    providerCapabilities,
    setProviderCapabilities,
    dataServerId,
  } = useProjectStore();
  const sessions = useProjectStore((s) => s.sessions);
  const projects = useProjectStore((s) => s.projects);
  const activeServerId = useServerStore((s) => s.activeServerId);

  const currentSession = sessions.find(s => s.id === sessionId);
  const currentProject = currentSession
    ? projects.find(p => p.id === currentSession.projectId)
    : null;

  const providerId = currentSession?.providerId || currentProject?.providerId;
  const isBackendDataReady = dataServerId != null && dataServerId === activeServerId;
  const providerScopeKey =
    resolveCanonicalBackendId(activeServerId ?? LEGACY_LOCAL_SERVER_ID, LEGACY_LOCAL_SERVER_ID)
    || LEGACY_LOCAL_SERVER_ID;
  const capsCacheKey = `${providerScopeKey}:${providerId || '_default'}`;
  const commandsCacheKey = `${providerScopeKey}:${providerId || '_default'}`;

  // Fetch commands when provider or project changes (via HTTP)
  useEffect(() => {
    const projectRoot = currentProject?.rootPath;
    const controller = new AbortController();

    if (!isConnected || !isBackendDataReady) {
      return () => controller.abort();
    }

    if (providerId) {
      api.getProviderCommands(providerId, projectRoot || undefined, { signal: controller.signal })
        .then(commands => {
          useProjectStore.getState().setProviderCommands(commandsCacheKey, commands);
        })
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error('Failed to load provider commands:', err);
        });
    } else {
      api.getProviderTypeCommands('claude', projectRoot || undefined, { signal: controller.signal })
        .then(commands => {
          useProjectStore.getState().setProviderCommands(commandsCacheKey, commands);
        })
        .catch(err => {
          if (err instanceof Error && err.name === 'AbortError') return;
          console.error('Failed to load default commands:', err);
        });
    }

    return () => controller.abort();
  }, [currentSession?.providerId, currentProject?.providerId, currentProject?.rootPath, isConnected, isBackendDataReady, commandsCacheKey]);

  useEffect(() => {
    const controller = new AbortController();
    if (!isConnected || !isBackendDataReady) return () => controller.abort();
    if (providerCapabilities[capsCacheKey]) return () => controller.abort();

    const fetchCaps = providerId
      ? api.getProviderCapabilities(providerId, { signal: controller.signal })
      : api.getProviderTypeCapabilities('claude', { signal: controller.signal });

    fetchCaps
      .then(caps => {
        setProviderCapabilities(capsCacheKey, caps);
        if (caps.defaultModeId && !useChatStore.getState().getMode(sessionId)) {
          useChatStore.getState().setMode(sessionId, caps.defaultModeId);
        }
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to load provider capabilities:', err);
      });
    return () => controller.abort();
  }, [capsCacheKey, providerId, isConnected, isBackendDataReady, providerCapabilities, setProviderCapabilities, sessionId]);

  const capabilities: ProviderCapabilities | null = providerCapabilities[capsCacheKey] || null;

  const commands = useMemo<SlashCommand[]>(() => {
    const base = providerCommands[commandsCacheKey] || [];
    const extras: SlashCommand[] = [
      {
        command: '/new-cli-session',
        description: 'Reset underlying provider session (next message starts a fresh CLI session)',
        source: 'local',
      },
      {
        command: '/reset-cli-session',
        description: 'Alias of /new-cli-session',
        source: 'local',
      },
    ];

    const seen = new Set(base.map((c) => c.command));
    const merged = [...base];
    for (const cmd of extras) {
      if (!seen.has(cmd.command)) merged.push(cmd);
    }
    return merged;
  }, [providerCommands, commandsCacheKey]);

  return {
    providerId,
    capabilities,
    commands,
    commandsCacheKey,
  };
}
