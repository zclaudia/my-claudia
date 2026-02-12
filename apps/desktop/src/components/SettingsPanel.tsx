import { useState, useEffect } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useGatewayStore, toGatewayServerId } from '../stores/gatewayStore';
import { useUIStore, type FontSizePreset } from '../stores/uiStore';
import { useConnection } from '../contexts/ConnectionContext';
import { ProviderManager } from './ProviderManager';
import { ThemeToggle } from './ThemeToggle';
import { ServerGatewayConfig } from './ServerGatewayConfig';
import { ImportDialog } from './ImportDialog';
import type { GatewayBackendInfo } from '@my-claudia/shared';

type SettingsTab = 'general' | 'connections' | 'providers' | 'gateway' | 'import';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [serverPickerOpen, setServerPickerOpen] = useState(false);

  const {
    connectionStatus,
    getActiveServer,
    activeServerId,
    servers,
    connections,
    setActiveServer
  } = useServerStore();
  const {
    isConnected: isGatewayConnected,
    discoveredBackends,
    backendAuthStatus
  } = useGatewayStore();
  const { connectServer } = useConnection();

  const isConnected = connectionStatus === 'connected';
  const activeServer = getActiveServer();
  const isLocalServer = activeServerId === 'local';
  const directServers = servers.filter(s => s.connectionMode !== 'gateway');

  // Reset tab if current tab is not available for the new server type
  useEffect(() => {
    if (!isLocalServer && (activeTab === 'import' || activeTab === 'gateway')) {
      setActiveTab('providers');
    }
  }, [activeServerId, activeTab, isLocalServer]);

  const handleServerSwitch = (serverId: string) => {
    setActiveServer(serverId);
    connectServer(serverId);
    setServerPickerOpen(false);
  };

  const handleBackendSwitch = (backend: GatewayBackendInfo) => {
    if (!backend.online) return;
    const serverId = toGatewayServerId(backend.backendId);
    setActiveServer(serverId);
    connectServer(serverId);
    setServerPickerOpen(false);
  };

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
    {
      id: 'connections',
      label: 'Connections',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
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
    ...(isLocalServer ? [
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

  // --- Connection status helper for server picker ---

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'connected': return 'bg-success';
      case 'connecting': return 'bg-warning animate-pulse';
      case 'error': return 'bg-destructive';
      default: return 'bg-muted-foreground';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] md:max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Tabs - horizontal on mobile, vertical sidebar on desktop */}
          <div className="flex md:flex-col md:w-44 border-b md:border-b-0 md:border-r border-border p-1 md:p-2 gap-0.5 overflow-x-auto md:overflow-x-visible shrink-0">
            {/* Section: App */}
            <div className="hidden md:block px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              App
            </div>
            {appTabs.map(renderTabButton)}

            {/* Section: Server (with server picker dropdown) */}
            <div className="hidden md:block relative border-t border-border mt-2">
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
                    {/* Direct servers */}
                    {directServers.map((server) => {
                      const isActive = server.id === activeServerId;
                      return (
                        <button
                          key={server.id}
                          onClick={() => handleServerSwitch(server.id)}
                          className={`w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm ${
                            isActive ? 'bg-muted' : ''
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(connections[server.id]?.status)}`} />
                          <span className="truncate flex-1" title={server.name}>{server.name}</span>
                          {isActive && (
                            <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded flex-shrink-0">
                              Active
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {/* Gateway backends */}
                    {isGatewayConnected && discoveredBackends.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/50 border-t border-border">
                          Via Gateway
                        </div>
                        {discoveredBackends.map((backend) => {
                          const gwId = toGatewayServerId(backend.backendId);
                          const isActive = activeServerId === gwId;
                          const authStatus = backendAuthStatus[backend.backendId];
                          let statusColor = 'bg-muted-foreground';
                          if (backend.online && authStatus === 'authenticated') statusColor = 'bg-success';
                          else if (backend.online && authStatus === 'pending') statusColor = 'bg-warning animate-pulse';
                          else if (backend.online) statusColor = 'bg-blue-400';

                          return (
                            <button
                              key={backend.backendId}
                              onClick={() => handleBackendSwitch(backend)}
                              disabled={!backend.online}
                              className={`w-full px-3 py-2 text-left hover:bg-muted flex items-center gap-2 text-sm ${
                                isActive ? 'bg-muted' : ''
                              } ${!backend.online ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                              <span className="truncate flex-1" title={backend.name}>{backend.name}</span>
                              {isActive && (
                                <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded flex-shrink-0">
                                  Active
                                </span>
                              )}
                              {!backend.online && (
                                <span className="text-[10px] text-muted-foreground flex-shrink-0">Offline</span>
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

            {/* Mobile: show server name as a label before server tabs */}
            <div className="md:hidden px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-l border-border ml-1">
              {activeServer?.name || 'Server'}
            </div>

            {serverTabs.map(renderTabButton)}
          </div>

          {/* Content area */}
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
                  <h3 className="text-sm font-medium mb-3">About</h3>
                  <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Version</span>
                      <span>0.1.0</span>
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
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'connections' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  View your backend server connections. Local server connects directly; gateway backends are discovered automatically.
                </p>
                <ServerInfoPanel />
              </div>
            )}

            {activeTab === 'providers' && (
              <div className="space-y-4">
                {!isLocalServer && activeServer && (
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

            {activeTab === 'gateway' && (
              <div className="space-y-6">
                <ServerGatewayConfig />
              </div>
            )}

            {activeTab === 'import' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Import Data</h3>
                <p className="text-sm text-muted-foreground">
                  Import sessions from other Claude CLI installations. This feature allows you to migrate your conversation history.
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
                        className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 text-sm"
                      >
                        Import from Claude CLI
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground p-3 bg-secondary/50 rounded-lg">
                  <strong>Note:</strong> Import functionality is only available when connected to a local server. The default Claude CLI directory is <code className="px-1 py-0.5 bg-background rounded">~/.claude</code>.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Import Dialog */}
      <ImportDialog
        isOpen={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
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
    <select
      value={fontSize}
      onChange={(e) => setFontSize(e.target.value as FontSizePreset)}
      className="px-2 py-1 bg-secondary border border-border rounded text-sm cursor-pointer focus:outline-none focus:border-primary"
    >
      {FONT_SIZE_OPTIONS.map((opt) => (
        <option key={opt.key} value={opt.key}>{opt.label}</option>
      ))}
    </select>
  );
}

// Inline version of ProviderManager for the settings panel
function ProviderManagerInline() {
  // We'll reuse the ProviderManager but render it inline
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <ProviderManager isOpen={true} onClose={() => {}} inline={true} />
    </div>
  );
}

// Read-only server info panel
function ServerInfoPanel() {
  const { servers, activeServerId, connections } = useServerStore();
  const { isConnected: isGatewayConnected, discoveredBackends, backendAuthStatus } = useGatewayStore();

  const getStatusInfo = (status?: string) => {
    switch (status) {
      case 'connected':
        return { color: 'bg-success', text: 'Connected' };
      case 'connecting':
        return { color: 'bg-warning', text: 'Connecting' };
      case 'error':
        return { color: 'bg-destructive', text: 'Error' };
      default:
        return { color: 'bg-muted-foreground', text: 'Disconnected' };
    }
  };

  // Filter out legacy gateway-mode servers (these are now handled via gateway discovery)
  const directServers = servers.filter(s => s.connectionMode !== 'gateway');

  return (
    <div className="space-y-3">
      {/* Direct servers */}
      {directServers.map((server) => {
        const conn = connections[server.id];
        const status = getStatusInfo(conn?.status);
        return (
          <div
            key={server.id}
            className={`p-3 border rounded-lg ${
              server.id === activeServerId ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-medium text-sm">{server.name}</span>
              {server.isDefault && (
                <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded">Default</span>
              )}
              {server.id === activeServerId && (
                <span className="px-1.5 py-0.5 bg-success/20 text-success text-xs rounded">Active</span>
              )}
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Address</span>
                <span>{server.address}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${status.color}`} />
                  {status.text}
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* Gateway backends */}
      {isGatewayConnected && discoveredBackends.length > 0 && (
        <>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">
            Via Gateway
          </div>
          {discoveredBackends.map((backend) => {
            const gwServerId = toGatewayServerId(backend.backendId);
            const authStatus = backendAuthStatus[backend.backendId];
            const isActive = activeServerId === gwServerId;

            let statusText = 'Offline';
            let statusColor = 'bg-muted-foreground';
            if (backend.online && authStatus === 'authenticated') {
              statusText = 'Connected';
              statusColor = 'bg-success';
            } else if (backend.online && authStatus === 'pending') {
              statusText = 'Connecting';
              statusColor = 'bg-warning';
            } else if (backend.online) {
              statusText = 'Online';
              statusColor = 'bg-blue-400';
            }

            return (
              <div
                key={backend.backendId}
                className={`p-3 border rounded-lg ${
                  isActive ? 'border-primary bg-primary/5' : 'border-border'
                } ${!backend.online ? 'opacity-60' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="font-medium text-sm">{backend.name}</span>
                  {isActive && (
                    <span className="px-1.5 py-0.5 bg-success/20 text-success text-xs rounded">Active</span>
                  )}
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Backend ID</span>
                    <span>{backend.backendId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                      {statusText}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
