import { useState, useEffect, useCallback } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useGatewayStore } from '../stores/gatewayStore';
import { useConnection } from '../contexts/ConnectionContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useAndroidBack } from '../hooks/useAndroidBack';
import { ProviderManager } from './settings/ProviderManager';
import { ServerGatewayConfig } from './settings/ServerGatewayConfig';
import { PluginSettings } from './settings/PluginSettings';
import { McpServerSettings } from './settings/McpServerSettings';
import { WorkspaceSkillsSettings } from './settings/WorkspaceSkillsSettings';
import { usePluginStore, selectPluginSettingsTabs } from '../stores/pluginStore';
import type { BackendConnectionState, BackendSnapshot, GatewayBackendInfo } from '@my-claudia/shared';
import { AgentSettings } from './settings/AgentSettings';
import { PermissionSettings } from './settings/PermissionSettings';
import { NotificationSettingsInline } from './settings/NotificationSettings';
import { MobileGatewayConfig } from './settings/MobileGatewayConfig';
import { DebugSettings } from './settings/DebugSettings';
import { GeneralSettings } from './settings/GeneralSettings';
import { ImportSettings } from './settings/ImportSettings';
import {
  type SettingsTab,
  type SettingsTabDef,
  getAppTabs,
  getServerTabs,
} from './settings/settingsTabDefs';

import {
  getMobileBackendViewState,
  getVisibleMobileBackends,
  isMobileBackendUsable,
  type MobileBackendViewState,
} from '../services/mobileConnectionState';

function getViewStateLabel(viewState: MobileBackendViewState): string | null {
  switch (viewState) {
    case 'transport_reconnecting':
      return 'Reconnecting';
    case 'backend_subscribing':
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

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const [mobileShowContent, setMobileShowContent] = useState(false);
  const isMobile = useIsMobile();
  const pluginSettingsTabs = usePluginStore(selectPluginSettingsTabs);

  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const { isConnected: isGatewayConnected, showLocalBackend } = useGatewayStore();
  const { sendMessage, connectServer, embeddedServerStatus, embeddedServerPort } = useConnection();

  const facadeBackends = useFacadeStore((s) => s.backends);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const localBackendId = useFacadeStore((s) => s.localBackendId);
  const currentInstanceId = useFacadeStore((s) => s.currentInstanceId);
  const activeServer = facadeBackends.find(b => b.backendId === activeServerId) ?? null;
  const isConnected = isMobileBackendUsable({
    backendId: activeServerId,
    connectionState: facadeConnectionState,
    backends: facadeBackends,
  });
  const isActiveLocalBackend = !!activeServerId && (
    activeServerId === localBackendId || activeServer?.isThisInstance === true
  );

  const isActiveRemote = !!activeServerId && !!localBackendId && activeServerId !== localBackendId;
  const effectiveShowLocal = showLocalBackend || isActiveRemote;
  const visibleGatewayBackends = getVisibleMobileBackends(facadeBackends, currentInstanceId, effectiveShowLocal);

  const appTabs = getAppTabs(!!isMobile);
  const serverTabs = getServerTabs({ isActiveLocalBackend, pluginSettingsTabs });

  useEffect(() => {
    if (!isActiveLocalBackend && activeTab === 'import') {
      setActiveTab('agent');
    }
    if (!isActiveLocalBackend && !isMobile && activeTab === 'gateway') {
      setActiveTab('agent');
    }
  }, [activeTab, isActiveLocalBackend, isMobile]);

  const handleBackendSwitch = (backend: GatewayBackendInfo) => {
    const viewState = getMobileBackendViewState(backend.backendId, facadeConnectionState, facadeBackends);
    if (viewState === 'offline') return;
    setActiveServer(backend.backendId);
    connectServer(backend.backendId);
    setServerPickerOpen(false);
  };

  const handleSwipeBack = useCallback(() => {
    if (mobileShowContent) {
      setMobileShowContent(false);
    } else {
      onClose();
    }
  }, [mobileShowContent, onClose]);

  useAndroidBack(handleSwipeBack, isMobile && isOpen, mobileShowContent ? 30 : 20);

  if (!isOpen) return null;

  const renderTabButton = (tab: SettingsTabDef) => (
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

  const renderMobileTabItem = (tab: SettingsTabDef) => (
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
        <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-border flex-shrink-0">
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
          {/* Mobile: Tab list */}
          {isMobile && !mobileShowContent && (
            <div className="flex-1 overflow-y-auto p-2">
              <div className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                App
              </div>
              {appTabs.map(renderMobileTabItem)}

              <div className="px-3 py-2 mt-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-t border-border">
                {activeServer?.name || 'Server'}
              </div>
              {serverTabs.map(renderMobileTabItem)}
            </div>
          )}

          {/* Desktop: Tabs vertical sidebar */}
          {!isMobile && (
            <div className="flex flex-col w-44 border-r border-border p-2 gap-0.5 shrink-0">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                App
              </div>
              {appTabs.map(renderTabButton)}

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

                {serverPickerOpen && (
                  <ServerPickerDropdown
                    isGatewayConnected={isGatewayConnected}
                    visibleGatewayBackends={visibleGatewayBackends}
                    activeServerId={activeServerId}
                    facadeConnectionState={facadeConnectionState}
                    facadeBackends={facadeBackends}
                    onClose={() => setServerPickerOpen(false)}
                    onSwitch={handleBackendSwitch}
                  />
                )}
              </div>

              {serverTabs.map(renderTabButton)}
            </div>
          )}

          {/* Content area */}
          {(!isMobile || mobileShowContent) && (
          <div className="flex-1 p-3 md:p-4 overflow-y-auto">
            {activeTab === 'general' && (
              <GeneralSettings
                isOpen={isOpen}
                activeServerExists={!!activeServer}
                embeddedServerPort={embeddedServerPort}
              />
            )}

            {activeTab === 'agent' && <AgentSettings />}
            {activeTab === 'permissions' && <PermissionSettings />}

            {activeTab === 'providers' && (
              <div className="space-y-4">
                {!isActiveLocalBackend && activeServer && (
                  <RemoteServerBanner serverName={activeServer.name} label="Viewing providers" />
                )}
                <p className="text-sm text-muted-foreground">
                  {isActiveLocalBackend
                    ? 'Manage AI providers for your projects on this server. Each provider can have different CLI paths and environment variables.'
                    : 'AI providers configured on this server.'}
                </p>
                <ProviderManagerInline key={activeServerId || 'none'} readOnly={!isActiveLocalBackend} />
              </div>
            )}

            {activeTab === 'notifications' && <NotificationSettingsInline />}

            {activeTab === 'gateway' && (
              <div className="space-y-6">
                {isMobile ? <MobileGatewayConfig /> : <ServerGatewayConfig />}
              </div>
            )}

            {activeTab === 'import' && <ImportSettings />}

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
                {!isActiveLocalBackend && activeServer && (
                  <RemoteServerBanner serverName={activeServer.name} label="Viewing MCP servers" />
                )}
                <p className="text-sm text-muted-foreground">
                  {isActiveLocalBackend
                    ? 'Manage MCP (Model Context Protocol) servers. These servers provide additional tools to AI providers.'
                    : 'MCP servers configured on this server.'}
                </p>
                <McpServerSettings readOnly={!isActiveLocalBackend} />
              </div>
            )}

            {activeTab === 'workspace' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Skills</h3>
                {!isActiveLocalBackend && activeServer && (
                  <RemoteServerBanner serverName={activeServer.name} label="Viewing skills" />
                )}
                <p className="text-sm text-muted-foreground">
                  {isActiveLocalBackend
                    ? 'Manage workspace skills and external skill directories. Skills are lazy-loaded tools available to all AI providers.'
                    : 'Workspace skills configured on this server.'}
                </p>
                <WorkspaceSkillsSettings readOnly={!isActiveLocalBackend} />
              </div>
            )}

            {activeTab === 'debug' && (
              <DebugSettings
                isConnected={isConnected}
                sendMessage={sendMessage}
                embeddedServerStatus={embeddedServerStatus}
              />
            )}

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
    </div>
  );
}

// --- Small inline helpers ---

function RemoteServerBanner({ serverName, label }: { serverName: string; label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm">
      <svg className="w-4 h-4 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{label} on <strong>{serverName}</strong> (read-only)</span>
    </div>
  );
}

function ProviderManagerInline({ readOnly }: { readOnly?: boolean }) {
  return (
    <ProviderManager isOpen={true} onClose={() => {}} inline={true} readOnly={readOnly} />
  );
}

function ServerPickerDropdown({
  isGatewayConnected,
  visibleGatewayBackends,
  activeServerId,
  facadeConnectionState,
  facadeBackends,
  onClose,
  onSwitch,
}: {
  isGatewayConnected: boolean;
  visibleGatewayBackends: GatewayBackendInfo[];
  activeServerId: string | null;
  facadeConnectionState: BackendConnectionState;
  facadeBackends: BackendSnapshot[];
  onClose: () => void;
  onSwitch: (backend: GatewayBackendInfo) => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-1 right-1 top-full bg-card border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
        {isGatewayConnected && visibleGatewayBackends.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/50 border-t border-border">
              Via Gateway
            </div>
            {visibleGatewayBackends.map((backend) => {
              const gwId = backend.backendId;
              const isActive = activeServerId === gwId;
              const viewState = getMobileBackendViewState(gwId, facadeConnectionState, facadeBackends);
              const isReachable = viewState !== 'offline';
              const statusColor = viewState === 'ready'
                ? 'bg-success'
                : viewState === 'transport_reconnecting' || viewState === 'backend_subscribing'
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
                  onClick={() => onSwitch(backend)}
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
  );
}
