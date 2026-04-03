import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useServerStore } from '../stores/serverStore';
import { useRecoveryStore } from '../stores/recoveryStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useGatewayStore, shouldShowNonCurrentInstanceBackend } from '../stores/gatewayStore';
import { useUIStore, type FontSizePreset } from '../stores/uiStore';
import { useConnection } from '../contexts/ConnectionContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { ProviderManager } from './ProviderManager';
import { ThemeToggle } from './ThemeToggle';
import { ServerGatewayConfig } from './ServerGatewayConfig';
import { ImportDialog } from './ImportDialog';
import { ImportOpenCodeDialog } from './ImportOpenCodeDialog';
import { PluginSettings } from './PluginSettings';
import { McpServerSettings } from './McpServerSettings';
import { WorkspaceSkillsSettings } from './WorkspaceSkillsSettings';
import { usePluginStore, selectPluginSettingsTabs } from '../stores/pluginStore';
import { useProcessMonitorStore } from '../stores/processMonitorStore';
import * as api from '../services/api';
import { exportLogs, getLogCount, clearLogs } from '../services/logger';
import type { GatewayBackendInfo, SdkVersionReport } from '@my-claudia/shared';
import type { CrashReportEntry, ManagedProcessRecord } from '../services/api/debug';
import { AgentSettings } from './settings/AgentSettings';
import { PermissionSettings } from './settings/PermissionSettings';
import { NotificationSettingsInline } from './settings/NotificationSettings';
import { MobileGatewayConfig } from './settings/MobileGatewayConfig';
import { isMacOS, isTauri } from '../utils/platform';
import { useControlPlaneMode } from '../hooks/useControlPlaneMode';
import type { BackendRecoveryViewState } from '../stores/recoveryStore';

function getViewStateLabel(viewState: BackendRecoveryViewState): string | null {
  switch (viewState) {
    case 'transport_reconnecting':
    case 'backend_recovering':
      return 'Reconnecting';
    case 'backend_opening':
    case 'catalog_syncing':
    case 'session_syncing':
      return 'Connecting';
    case 'backend_visible':
      return 'Idle';
    case 'error':
      return 'Error';
    case 'offline':
      return 'Offline';
    default:
      return null;
  }
}

type SettingsTab = 'general' | 'agent' | 'permissions' | 'providers' | 'notifications' | 'gateway' | 'import' | 'plugins' | 'mcp-servers' | 'workspace' | 'debug' | `plugin:${string}`;

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [openCodeImportDialogOpen, setOpenCodeImportDialogOpen] = useState(false);
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const [mobileShowContent, setMobileShowContent] = useState(false);
  const isMobile = useIsMobile();
  const pluginSettingsTabs = usePluginStore(selectPluginSettingsTabs);
  const controlPlaneMode = useControlPlaneMode();

  const {
    activeServerId,
    setActiveServer
  } = useServerStore();
  const {
    isConnected: isGatewayConnected,
    showLocalBackend,
  } = useGatewayStore();
  const { sendMessage, connectServer, embeddedServerStatus, embeddedServerError, embeddedServerPort, restartEmbeddedServer } = useConnection();
  const [leakCleanupRunning, setLeakCleanupRunning] = useState(false);
  const [leakCleanupResult, setLeakCleanupResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [crashReports, setCrashReports] = useState<CrashReportEntry[]>([]);
  const [crashReportsPath, setCrashReportsPath] = useState<string | null>(null);
  const [crashReportsLoading, setCrashReportsLoading] = useState(false);
  const [crashReportsError, setCrashReportsError] = useState<string | null>(null);
  const [managedProcesses, setManagedProcesses] = useState<ManagedProcessRecord[]>([]);
  const [managedProcessesLoading, setManagedProcessesLoading] = useState(false);
  const [managedProcessesError, setManagedProcessesError] = useState<string | null>(null);
  const cleanupResult = useProcessMonitorStore((state) => state.lastCleanupResult);
  const clearCleanupResult = useProcessMonitorStore((state) => state.clearCleanupResult);

  const facadeBackends = useFacadeStore((s) => s.backends);
  const localBackendId = useFacadeStore((s) => s.localBackendId);
  const currentInstanceId = useFacadeStore((s) => s.currentInstanceId);
  const activeServer = facadeBackends.find(b => b.backendId === activeServerId) ?? null;
  const isConnected = useRecoveryStore((s) => {
    if (!activeServerId) return false;
    return s.backends[activeServerId]?.status === 'ready';
  });
  const recoveryState = useRecoveryStore((s) => s);
  const isActiveLocalBackend = !!activeServerId && (
    activeServerId === localBackendId || activeServer?.isThisInstance === true
  );
  const isEmbeddedLocalMode = controlPlaneMode === 'embedded-local';
  const visibleGatewayBackends = facadeBackends.filter(b => shouldShowNonCurrentInstanceBackend(b, currentInstanceId, showLocalBackend));

  // SDK version check
  const localServerPort = useServerStore((s) => s.localServerPort);
  const [sdkVersions, setSdkVersions] = useState<SdkVersionReport | null>(null);
  useEffect(() => {
    if (!isOpen || !activeServer) return;
    const address = `localhost:${localServerPort || 3100}`;
    api.getServerInfo(address)
      .then(info => {
        setSdkVersions(info.sdkVersions ?? null);
      })
      .catch(() => {
        setSdkVersions(null);
      });
  }, [isOpen, activeServer, localServerPort]);

  const handleLeakCleanup = useCallback(() => {
    if (!isConnected) {
      setLeakCleanupResult({ ok: false, message: 'Connect to the server before running process cleanup.' });
      return;
    }

    setLeakCleanupRunning(true);
    clearCleanupResult();
    setLeakCleanupResult(null);
    try {
      sendMessage({ type: 'kill_leaked_processes' });
    } catch (err) {
      setLeakCleanupResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to request process cleanup.',
      });
      setLeakCleanupRunning(false);
    }
  }, [clearCleanupResult, isConnected, sendMessage]);

  useEffect(() => {
    if (!cleanupResult) return;

    setLeakCleanupRunning(false);

    if (cleanupResult.status === 'skipped_active_runs') {
      setLeakCleanupResult({
        ok: false,
        message: `Cleanup skipped because ${cleanupResult.activeRunCount} active run(s) are still in progress.`,
      });
      return;
    }

    if (cleanupResult.status === 'clean') {
      setLeakCleanupResult({
        ok: true,
        message: 'Cleanup completed. No leaked child processes were found.',
      });
      return;
    }

    setLeakCleanupResult({
      ok: cleanupResult.killedCount > 0,
      message: cleanupResult.killedCount > 0
        ? `Cleanup completed. Terminated ${cleanupResult.killedCount} of ${cleanupResult.leakedCount} leaked process(es).`
        : `Cleanup completed, but none of the ${cleanupResult.leakedCount} leaked process(es) could be terminated.`,
    });
  }, [cleanupResult]);

  const loadCrashReports = useCallback(async () => {
    setCrashReportsLoading(true);
    setCrashReportsError(null);
    try {
      const result = await api.getCrashReports();
      setCrashReports(result.reports);
      setCrashReportsPath(result.filePath);
    } catch (err) {
      setCrashReports([]);
      setCrashReportsPath(null);
      setCrashReportsError(err instanceof Error ? err.message : 'Failed to load crash reports');
    } finally {
      setCrashReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || activeTab !== 'debug' || embeddedServerStatus === 'disabled') return;
    void loadCrashReports();
  }, [activeTab, embeddedServerStatus, isOpen, loadCrashReports]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'debug' || embeddedServerStatus === 'disabled') return;

    let cancelled = false;

    const loadManagedProcesses = async () => {
      setManagedProcessesLoading(true);
      try {
        const records = await api.getManagedProcesses();
        if (!cancelled) {
          setManagedProcesses(records);
          setManagedProcessesError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setManagedProcessesError(err instanceof Error ? err.message : 'Failed to load managed processes');
        }
      } finally {
        if (!cancelled) {
          setManagedProcessesLoading(false);
        }
      }
    };

    void loadManagedProcesses();
    const interval = setInterval(() => {
      void loadManagedProcesses();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab, embeddedServerStatus, isOpen]);

  // macOS permission checks
  const [fdaGranted, setFdaGranted] = useState<boolean | null>(null);
  const [folderPerms, setFolderPerms] = useState<{ name: string; granted: boolean }[]>([]);
  useEffect(() => {
    if (!isMacOS() || !isOpen) return;
    invoke<boolean>('check_full_disk_access').then(setFdaGranted).catch(() => setFdaGranted(null));
    invoke<{ name: string; granted: boolean }[]>('check_folder_permissions').then(setFolderPerms).catch(() => {});
  }, [isOpen]);

  // Reset tab if current tab is not available for the new server type
  // Note: 'gateway' tab is always available on mobile for editing gateway config
  useEffect(() => {
    if (isEmbeddedLocalMode) return;
    if (activeTab === 'agent' || activeTab === 'workspace' || activeTab === 'mcp-servers' || activeTab === 'gateway' || activeTab === 'import') {
      setActiveTab('providers');
    }
  }, [activeTab, isEmbeddedLocalMode]);

  const handleBackendSwitch = (backend: GatewayBackendInfo) => {
    if (recoveryState.getBackendViewState(backend.backendId) !== 'ready') return;
    const serverId = backend.backendId;
    setActiveServer(serverId);
    connectServer(serverId);
    setServerPickerOpen(false);
  };

  const handleSwipeBack = useCallback(() => {
    if (mobileShowContent) {
      setMobileShowContent(false);
    } else {
      onClose();
    }
  }, [mobileShowContent, onClose]);

  // Android back gesture: content → tab list (pri 30), tab list → close (pri 20)
  useAndroidBack(handleSwipeBack, isMobile && isOpen, mobileShowContent ? 30 : 20);

  if (!isOpen) return null;

  // --- Tab definitions ---

  const appTabs: { id: SettingsTab; label: string; icon: JSX.Element }[] = [
    {
      id: 'general',
      label: 'General',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    },
    ...(isEmbeddedLocalMode ? [{
      id: 'agent' as SettingsTab,
      label: 'Claudia',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
    }] : []),
    {
      id: 'permissions' as SettingsTab,
      label: 'Permissions',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      )
    },
    {
      id: 'plugins' as SettingsTab,
      label: 'Plugins',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      )
    },
    ...pluginSettingsTabs.map(tab => ({
      id: `plugin:${tab.id}` as SettingsTab,
      label: tab.label,
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
        </svg>
      )
    })),
    ...(isMobile ? [{
      id: 'gateway' as SettingsTab,
      label: 'Gateway',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      )
    }] : []),
    {
      id: 'debug' as SettingsTab,
      label: 'Debug',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
  ];

  const serverTabs: { id: SettingsTab; label: string; icon: JSX.Element }[] = [
    {
      id: 'providers',
      label: 'Providers',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      )
    },
    ...(isEmbeddedLocalMode ? [{
      id: 'mcp-servers' as SettingsTab,
      label: 'MCP Servers',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
        </svg>
      )
    },
    {
      id: 'workspace' as SettingsTab,
      label: 'Skills',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      )
    }] : []),
    {
      id: 'notifications' as SettingsTab,
      label: 'Notifications',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      )
    },
    ...(isEmbeddedLocalMode ? [
      {
        id: 'gateway' as SettingsTab,
        label: 'Gateway',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        )
      },
      {
        id: 'import' as SettingsTab,
        label: 'Import',
        icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        )
      },
    ] : []),
  ];

  // --- Tab button renderer ---

  const renderTabButton = (tab: { id: SettingsTab; label: string; icon: JSX.Element }) => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      data-testid={`${tab.id}-tab`}
      className={`flex-shrink-0 px-3 py-2 rounded text-sm flex items-center gap-2 transition-colors ${
        activeTab === tab.id
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      {tab.icon}
      <span className="whitespace-nowrap">{tab.label}</span>
    </button>
  );

  return (
    <div className={`fixed inset-0 z-50 ${isMobile ? '' : 'flex items-center justify-center p-2 md:p-4'}`}>
      {!isMobile && <div className="absolute inset-0 bg-black/50" onClick={onClose} />}
      <div className={`relative bg-card flex flex-col ${
        isMobile
          ? 'w-full h-full safe-top-pad safe-bottom-pad'
          : 'border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh]'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-border flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (isMobile && mobileShowContent) {
                  setMobileShowContent(false);
                } else {
                  onClose();
                }
              }}
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground md:hidden"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-lg font-semibold">
              {isMobile && mobileShowContent
                ? [...appTabs, ...serverTabs].find(t => t.id === activeTab)?.label || 'Settings'
                : 'Settings'
              }
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground hidden md:block"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Mobile: Tab list (two-level navigation) */}
          {isMobile && !mobileShowContent && (
            <div className="flex-1 overflow-y-auto p-2">
              {/* App section */}
              <div className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                App
              </div>
              {appTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setMobileShowContent(true); }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-secondary/50 active:bg-secondary transition-colors"
                >
                  <span className="text-muted-foreground">{tab.icon}</span>
                  <span className="flex-1 text-sm text-left">{tab.label}</span>
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}

              {/* Server section */}
              <div className="px-3 py-2 mt-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border">
                {activeServer?.name || 'Server'}
              </div>
              {serverTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id); setMobileShowContent(true); }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-secondary/50 active:bg-secondary transition-colors"
                >
                  <span className="text-muted-foreground">{tab.icon}</span>
                  <span className="flex-1 text-sm text-left">{tab.label}</span>
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          )}

          {/* Desktop: Tabs vertical sidebar */}
          {!isMobile && (
            <div className="flex flex-col w-44 border-r border-border p-2 gap-0.5 shrink-0">
              {/* Section: App */}
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                App
              </div>
              {appTabs.map(renderTabButton)}

              {/* Section: Server (with server picker dropdown) */}
              <div className="relative border-t border-border mt-2">
                <button
                  onClick={() => setServerPickerOpen(!serverPickerOpen)}
                  className="w-full px-3 pt-3 pb-1.5 flex items-center justify-between group"
                >
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate" title={activeServer?.name || 'Server'}>
                    {activeServer?.name || 'Server'}
                  </span>
                  <svg
                    className={`w-3 h-3 text-muted-foreground group-hover:text-foreground transition-transform ${serverPickerOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Server picker dropdown */}
                {serverPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setServerPickerOpen(false)} />
                    <div className="absolute left-1 right-1 top-full bg-card border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                      {/* Gateway backends */}
                      {isGatewayConnected && visibleGatewayBackends.length > 0 && (
                        <>
                          <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/50 border-t border-border">
                            Via Gateway
                          </div>
                          {visibleGatewayBackends.map((backend) => {
                            const gwId = backend.backendId;
                            const isActive = activeServerId === gwId;
                            const viewState = recoveryState.getBackendViewState(gwId);
                            const isReachable = viewState === 'ready';
                            const statusColor = viewState === 'ready'
                              ? 'bg-success'
                              : viewState === 'transport_reconnecting' || viewState === 'backend_opening' || viewState === 'catalog_syncing' || viewState === 'session_syncing' || viewState === 'backend_recovering'
                              ? 'bg-warning animate-pulse'
                              : viewState === 'backend_visible'
                              ? 'bg-warning'
                              : viewState === 'error'
                              ? 'bg-destructive'
                              : 'bg-muted-foreground';
                            const statusLabel = getViewStateLabel(viewState);

                            return (
                              <button
                                key={backend.backendId}
                                onClick={() => handleBackendSwitch(backend)}
                                disabled={!isReachable}
                                className={`w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm ${
                                  isActive ? 'bg-muted' : ''
                                } ${!isReachable ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                                <span className="truncate flex-1" title={backend.name}>{backend.name}</span>
                                {isActive && (
                                  <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded flex-shrink-0">
                                    Active
                                  </span>
                                )}
                                {!isReachable && statusLabel && (
                                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                    {statusLabel}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {serverTabs.map(renderTabButton)}
            </div>
          )}

          {/* Content area (desktop: always shown; mobile: only when tab selected) */}
          {(!isMobile || mobileShowContent) && (
          <div className="flex-1 p-3 md:p-4 overflow-y-auto">
            {activeTab === 'general' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-medium mb-3">Appearance</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                        </svg>
                        <span className="text-sm">Theme</span>
                      </div>
                      <ThemeToggle />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
                        </svg>
                        <span className="text-sm">Font Size</span>
                      </div>
                      <FontSizeToggle />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-3">Local Server</h3>
                  <div className="space-y-3">
                    <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
                      <div>
                        <div>
                          <div className="text-sm">Embedded server runtime</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            AI review now relies on local deterministic redaction rules before sending content to the remote reviewer.
                          </div>
                        </div>
                      </div>

                      <div className="p-3 bg-background/70 rounded-lg space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Runtime status</span>
                          <span className={
                            embeddedServerStatus === 'ready'
                              ? 'text-success'
                              : embeddedServerStatus === 'error'
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                          }>
                            {embeddedServerStatus}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Port</span>
                          <span>{embeddedServerPort ?? '-'}</span>
                        </div>
                        {embeddedServerError && (
                          <div className="text-xs text-destructive break-all">
                            {embeddedServerError}
                          </div>
                        )}
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Changes to AI review and permission behavior apply on the next embedded server start.
                      </div>

                      {embeddedServerStatus !== 'disabled' && (
                        <div className="flex justify-end">
                          <button
                            onClick={() => { void restartEmbeddedServer(); }}
                            className="px-3 py-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
                          >
                            Restart Embedded Server
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {isMacOS() && fdaGranted !== null && (
                <div>
                  <h3 className="text-sm font-medium mb-3">Permissions</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        <div>
                          <span className="text-sm">Full Disk Access</span>
                          {!fdaGranted && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Required for terminal to access all directories
                            </p>
                          )}
                        </div>
                      </div>
                      {fdaGranted ? (
                        <span className="text-sm text-success">Granted</span>
                      ) : (
                        <button
                          onClick={() => invoke('open_full_disk_access_settings')}
                          className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium transition-colors"
                        >
                          Open Settings
                        </button>
                      )}
                    </div>
                    {folderPerms.length > 0 && folderPerms.some(f => !f.granted) && (
                      <div className="p-3 bg-secondary/50 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm">Folder Access</span>
                          <button
                            onClick={() => invoke('open_files_and_folders_settings')}
                            className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium transition-colors"
                          >
                            Open Settings
                          </button>
                        </div>
                        <div className="space-y-1">
                          {folderPerms.map(f => (
                            <div key={f.name} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">~/{f.name}</span>
                              {f.granted ? (
                                <span className="text-success">Granted</span>
                              ) : (
                                <span className="text-destructive">Denied</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                )}

                <div>
                  <h3 className="text-sm font-medium mb-3">About</h3>
                  <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Version</span>
                      <span>{__APP_VERSION__}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Connection</span>
                      <span className={isConnected ? 'text-success' : 'text-muted-foreground'}>
                        {isConnected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                    {activeServer && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Server</span>
                        <span>{activeServer.name}</span>
                      </div>
                    )}
                    {embeddedServerStatus !== 'disabled' && (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Embedded Server</span>
                          <span className={
                            embeddedServerStatus === 'ready' ? 'text-success' :
                            embeddedServerStatus === 'error' ? 'text-destructive' :
                            'text-muted-foreground'
                          }>
                            {embeddedServerStatus}{embeddedServerPort ? ` :${embeddedServerPort}` : ''}
                          </span>
                        </div>
                        {embeddedServerError && (
                          <div className="text-xs text-destructive break-all">
                            {embeddedServerError}
                          </div>
                        )}
                      </>
                    )}
                    {sdkVersions && sdkVersions.sdks.length > 0 && (
                      <>
                        <div className="border-t border-border/50 my-1.5" />
                        {sdkVersions.sdks.map(sdk => (
                          <div key={sdk.name} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{sdk.name.split('/').pop()}</span>
                            <span className={sdk.outdated ? 'text-amber-500' : 'text-muted-foreground'}>
                              {sdk.current}{sdk.outdated ? ` → ${sdk.latest}` : ''}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>

              </div>
            )}

            {activeTab === 'agent' && (
              <AgentSettings />
            )}

            {activeTab === 'permissions' && (
              <PermissionSettings />
            )}

            {activeTab === 'providers' && (
              <div className="space-y-4">
                {!isActiveLocalBackend && activeServer && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm">
                    <svg className="w-4 h-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>
                      Managing providers on <strong>{activeServer.name}</strong>
                    </span>
                  </div>
                )}
                <p className="text-sm text-muted-foreground">
                  Manage AI providers for your projects on this server. Each provider can have different CLI paths and environment variables.
                </p>
                <ProviderManagerInline key={activeServerId || 'none'} />
              </div>
            )}


            {activeTab === 'notifications' && (
              <NotificationSettingsInline key={activeServerId || 'none'} />
            )}

            {activeTab === 'gateway' && (
              <div className="space-y-6">
                {isMobile ? (
                  <MobileGatewayConfig />
                ) : (
                  <ServerGatewayConfig />
                )}
              </div>
            )}

            {activeTab === 'import' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Import Data</h3>
                <p className="text-sm text-muted-foreground">
                  Import sessions from other AI coding assistants. This feature allows you to migrate your conversation history.
                </p>

                <div className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">Claude CLI Sessions</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Import conversation history from the official Anthropic Claude CLI. You can select which sessions to import and specify the target project.
                      </p>
                      <button
                        onClick={() => setImportDialogOpen(true)}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-apple-sm transition-colors"
                      >
                        Import from Claude CLI
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium mb-1">OpenCode Sessions</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        Import conversation history from OpenCode. Sessions are read from OpenCode's local SQLite database.
                      </p>
                      <button
                        onClick={() => setOpenCodeImportDialogOpen(true)}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-apple-sm transition-colors"
                      >
                        Import from OpenCode
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground p-3 bg-secondary/50 rounded-lg">
                  <strong>Note:</strong> Import functionality is only available when connected to a local server.
                </div>
              </div>
            )}

            {activeTab === 'plugins' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Plugins</h3>
                <p className="text-sm text-muted-foreground">
                  Manage installed plugins and their settings. Plugins extend the functionality of Claudia.
                </p>
                <PluginSettings />
              </div>
            )}

            {activeTab === 'mcp-servers' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">MCP Servers</h3>
                <p className="text-sm text-muted-foreground">
                  Manage MCP (Model Context Protocol) servers. These servers provide additional tools to AI providers.
                </p>
                <McpServerSettings />
              </div>
            )}

            {activeTab === 'workspace' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Skills</h3>
                <p className="text-sm text-muted-foreground">
                  Manage workspace skills and external skill directories. Skills are lazy-loaded tools available to all AI providers.
                </p>
                <WorkspaceSkillsSettings />
              </div>
            )}

            {activeTab === 'debug' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Debug</h3>
                <p className="text-sm text-muted-foreground">
                  Diagnostics and troubleshooting tools.
                </p>

                <div className="space-y-3">
                  <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm">Crash Reports</div>
                        <div className="text-xs text-muted-foreground">
                          Recent embedded server fatal crashes stored on disk.
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { void loadCrashReports(); }}
                          disabled={crashReportsLoading || embeddedServerStatus === 'disabled'}
                          className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground text-secondary-foreground rounded-md transition-colors"
                        >
                          {crashReportsLoading ? 'Refreshing…' : 'Refresh'}
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(JSON.stringify(crashReports, null, 2));
                            } catch (err) {
                              console.error('[Settings] Failed to copy crash reports:', err);
                            }
                          }}
                          disabled={crashReports.length === 0}
                          className="px-2 py-1 text-xs bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-md transition-colors"
                        >
                          Copy JSON
                        </button>
                      </div>
                    </div>
                    {crashReportsPath && (
                      <div className="text-[11px] text-muted-foreground break-all">
                        {crashReportsPath}
                      </div>
                    )}
                    {crashReportsError && (
                      <div className="text-xs text-destructive">{crashReportsError}</div>
                    )}
                    {!crashReportsError && crashReports.length === 0 && !crashReportsLoading && (
                      <div className="text-xs text-muted-foreground">No crash reports recorded.</div>
                    )}
                    {crashReports.length > 0 && (
                      <div className="space-y-2">
                        {crashReports.map((report) => (
                          <div key={report.id} className="p-3 bg-background/70 rounded-lg space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium">{report.event}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {new Date(report.ts).toLocaleString()}
                              </div>
                            </div>
                            <div className="text-xs break-words">{report.message}</div>
                            <div className="text-[11px] text-muted-foreground">
                              v{report.version} • pid {report.pid} • {report.platform}
                            </div>
                            {report.stack && (
                              <pre className="mt-2 max-h-32 overflow-auto rounded bg-card px-2 py-1.5 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                                {report.stack}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm">Client Logs</div>
                        <div className="text-xs text-muted-foreground">{getLogCount()} entries in buffer</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { clearLogs(); }}
                          className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md transition-colors"
                        >
                          Clear
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              const logs = exportLogs();
                              const ts = new Date().toISOString().replace(/[:.]/g, '-');
                              const fileName = `my-claudia-logs-${ts}.json`;
                              const blob = new Blob([logs], { type: 'application/json' });

                              if (isTauri()) {
                                const { downloadDir } = await import('@tauri-apps/api/path');
                                const { writeFile } = await import('@tauri-apps/plugin-fs');
                                const dir = await downloadDir();
                                const filePath = `${dir}/${fileName}`;
                                await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
                                if (!navigator.userAgent.includes('Android')) {
                                  const { open } = await import('@tauri-apps/plugin-shell');
                                  await open(dir);
                                }
                              } else {
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = fileName;
                                a.click();
                                URL.revokeObjectURL(url);
                              }
                            } catch (err) {
                              console.error('[Settings] Failed to export logs:', err);
                            }
                          }}
                          className="px-3 py-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
                        >
                          Export Logs
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm">Managed Processes</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Read-only process registry for product-owned commands and adopted roots.
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          setManagedProcessesLoading(true);
                          try {
                            const records = await api.getManagedProcesses();
                            setManagedProcesses(records);
                            setManagedProcessesError(null);
                          } catch (err) {
                            setManagedProcessesError(err instanceof Error ? err.message : 'Failed to load managed processes');
                          } finally {
                            setManagedProcessesLoading(false);
                          }
                        }}
                        disabled={managedProcessesLoading || embeddedServerStatus === 'disabled'}
                        className="px-3 py-1 text-xs bg-secondary hover:bg-secondary/80 disabled:bg-muted disabled:text-muted-foreground text-secondary-foreground rounded-lg font-medium transition-colors"
                      >
                        {managedProcessesLoading ? 'Refreshing…' : 'Refresh'}
                      </button>
                    </div>
                    {managedProcessesError && (
                      <div className="text-xs text-destructive">{managedProcessesError}</div>
                    )}
                    {!managedProcessesError && managedProcesses.length === 0 && !managedProcessesLoading && (
                      <div className="text-xs text-muted-foreground">No managed processes recorded yet.</div>
                    )}
                    {managedProcesses.length > 0 && (
                      <div className="space-y-2 max-h-72 overflow-auto">
                        {managedProcesses.map((process) => (
                          <div key={process.processId} className="p-3 bg-background/70 rounded-lg space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium break-all">
                                {process.command} {process.args.join(' ')}
                              </div>
                              <div className="text-[11px] text-muted-foreground uppercase">
                                {process.status}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span>{process.source}</span>
                              <span>pid {process.rootPid ?? process.pid ?? 'n/a'}</span>
                              <span>{process.childCount} {process.childCount === 1 ? 'child' : 'children'}</span>
                              {process.adopted && <span>adopted</span>}
                              {process.tags.length > 0 && <span>{process.tags.join(', ')}</span>}
                            </div>
                            {process.cwd && (
                              <div className="text-[11px] text-muted-foreground break-all">
                                cwd: {process.cwd}
                              </div>
                            )}
                            {(process.ownerSessionId || process.ownerTaskId) && (
                              <div className="text-[11px] text-muted-foreground break-all">
                                owner: {process.ownerSessionId ? `session ${process.ownerSessionId}` : ''}
                                {process.ownerSessionId && process.ownerTaskId ? ' • ' : ''}
                                {process.ownerTaskId ? `task ${process.ownerTaskId}` : ''}
                              </div>
                            )}
                            <div className="text-[11px] text-muted-foreground">
                              started {new Date(process.startedAt).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
                    <div>
                      <div className="text-sm">Leaked Process Cleanup</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Trigger an immediate server-side scan for orphaned provider child processes and terminate any matches.
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted-foreground">
                        {isConnected ? 'Connected to active server' : 'Server disconnected'}
                      </div>
                      <button
                        onClick={handleLeakCleanup}
                        disabled={leakCleanupRunning || !isConnected}
                        className="px-3 py-1 text-xs bg-destructive hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground text-destructive-foreground rounded-lg font-medium transition-colors"
                      >
                        {leakCleanupRunning ? 'Cleaning…' : 'Clean Leaked Processes'}
                      </button>
                    </div>
                    {leakCleanupResult && (
                      <div className={`text-xs ${leakCleanupResult.ok ? 'text-success' : 'text-destructive'}`}>
                        {leakCleanupResult.message}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Dynamic plugin settings tabs */}
            {typeof activeTab === 'string' && activeTab.startsWith('plugin:') && (() => {
              const tabId = activeTab.slice(7);
              const tab = pluginSettingsTabs.find(t => t.id === tabId);
              if (!tab) return null;
              const Component = tab.component as React.ComponentType | undefined;
              return (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">{tab.label}</h3>
                  {Component ? <Component /> : (
                    <p className="text-sm text-muted-foreground">No settings UI available for this plugin.</p>
                  )}
                </div>
              );
            })()}
          </div>
          )}
        </div>
      </div>

      {/* Import Dialogs */}
      <ImportDialog
        isOpen={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
      />
      <ImportOpenCodeDialog
        isOpen={openCodeImportDialogOpen}
        onClose={() => setOpenCodeImportDialogOpen(false)}
      />
    </div>
  );
}

const FONT_SIZE_OPTIONS: { key: FontSizePreset; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];

function FontSizeToggle() {
  const { fontSize, setFontSize } = useUIStore();

  return (
    <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 gap-0.5">
      {FONT_SIZE_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => setFontSize(opt.key)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
            fontSize === opt.key
              ? 'bg-card text-foreground shadow-apple-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ProviderManagerInline() {
  return (
    <ProviderManager isOpen={true} onClose={() => {}} inline={true} />
  );
}
