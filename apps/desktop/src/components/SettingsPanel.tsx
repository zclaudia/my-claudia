import { useState, useEffect, useCallback } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useGatewayStore, toGatewayServerId } from '../stores/gatewayStore';
import { useUIStore, type FontSizePreset } from '../stores/uiStore';
import { useAgentStore } from '../stores/agentStore';
import { useConnection } from '../contexts/ConnectionContext';
import { ProviderManager } from './ProviderManager';
import { ThemeToggle } from './ThemeToggle';
import { ServerGatewayConfig } from './ServerGatewayConfig';
import { ImportDialog } from './ImportDialog';
import * as api from '../services/api';
import type { GatewayBackendInfo, ProviderConfig, AgentPermissionPolicy } from '@my-claudia/shared';

type SettingsTab = 'general' | 'connections' | 'providers' | 'agent' | 'gateway' | 'import';

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
    {
      id: 'agent',
      label: 'Agent',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
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
                    {isGatewayConnected && discoveredBackends.filter(b => !b.isLocal).length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-secondary/50 border-t border-border">
                          Via Gateway
                        </div>
                        {discoveredBackends.filter(b => !b.isLocal).map((backend) => {
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

            {activeTab === 'agent' && (
              <AgentSettingsInline key={activeServerId || 'none'} />
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

// Agent settings inline component
const DEFAULT_POLICY: AgentPermissionPolicy = {
  enabled: false,
  trustLevel: 'conservative',
  customRules: [],
  escalateAlways: ['AskUserQuestion'],
};

const TRUST_LEVELS: Array<{
  id: AgentPermissionPolicy['trustLevel'];
  label: string;
  description: string;
}> = [
  {
    id: 'conservative',
    label: 'Conservative',
    description: 'Auto-approve read-only tools (Read, Glob, Grep). Everything else asks you.',
  },
  {
    id: 'moderate',
    label: 'Moderate',
    description: 'Also auto-approve file edits (Write, Edit). Bash still asks you.',
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'Auto-approve most tools including safe Bash commands. Only dangerous commands ask.',
  },
];

function AgentSettingsInline() {
  const { selectedProviderId, setSelectedProviderId, permissionPolicy, updatePermissionPolicy } = useAgentStore();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [policy, setPolicy] = useState<AgentPermissionPolicy>(permissionPolicy || DEFAULT_POLICY);
  const [localProviderId, setLocalProviderId] = useState<string | null>(selectedProviderId);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load providers
  useEffect(() => {
    api.getProviders()
      .then(setProviders)
      .catch(err => console.error('[AgentSettings] Failed to load providers:', err));
  }, []);

  // Load agent config from server
  useEffect(() => {
    api.getAgentConfig()
      .then(config => {
        if (config.providerId) {
          setLocalProviderId(config.providerId);
        }
        if (config.permissionPolicy) {
          try {
            const parsed = typeof config.permissionPolicy === 'string'
              ? JSON.parse(config.permissionPolicy)
              : config.permissionPolicy;
            setPolicy(parsed);
          } catch {
            // Use default
          }
        }
      })
      .catch(err => console.error('[AgentSettings] Failed to load config:', err));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await api.updateAgentConfig({
        providerId: localProviderId || undefined,
        permissionPolicy: JSON.stringify(policy),
      });
      updatePermissionPolicy(policy);
      if (localProviderId) {
        setSelectedProviderId(localProviderId);
      }
      setDirty(false);
    } catch (err) {
      console.error('[AgentSettings] Failed to save:', err);
    } finally {
      setSaving(false);
    }
  }, [localProviderId, policy, updatePermissionPolicy, setSelectedProviderId]);

  const updatePolicy = useCallback((update: Partial<AgentPermissionPolicy>) => {
    setPolicy(prev => ({ ...prev, ...update }));
    setDirty(true);
  }, []);

  const handleProviderChange = useCallback((providerId: string) => {
    setLocalProviderId(providerId);
    setDirty(true);
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure the Agent Assistant's provider and permission settings.
      </p>

      {/* Provider selection */}
      <div>
        <h3 className="text-sm font-medium mb-3">Provider</h3>
        <div className="p-3 bg-secondary/50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">AI Provider</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select which provider the agent uses
              </p>
            </div>
            <select
              value={localProviderId || ''}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="px-2 py-1 bg-secondary border border-border rounded text-sm cursor-pointer focus:outline-none focus:border-primary max-w-[180px] truncate"
            >
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Permission settings */}
      <div>
        <h3 className="text-sm font-medium mb-3">Permissions</h3>
        <div className="space-y-4">
          {/* Master toggle */}
          <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
            <div>
              <p className="text-sm">Auto-approve permissions</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Let the agent automatically handle permission requests
              </p>
            </div>
            <button
              onClick={() => updatePolicy({ enabled: !policy.enabled })}
              className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                policy.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  policy.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {policy.enabled && (
            <>
              {/* Trust level */}
              <div>
                <p className="text-sm font-medium mb-2">Trust level</p>
                <div className="space-y-2">
                  {TRUST_LEVELS.map(level => (
                    <button
                      key={level.id}
                      onClick={() => updatePolicy({ trustLevel: level.id })}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        policy.trustLevel === level.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                          policy.trustLevel === level.id ? 'border-primary' : 'border-muted-foreground/40'
                        }`}>
                          {policy.trustLevel === level.id && (
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                          )}
                        </div>
                        <span className="text-sm font-medium">{level.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 ml-5">
                        {level.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick reference */}
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">What gets auto-approved:</p>
                <div className="space-y-1">
                  <PolicyRow label="Read, Glob, Grep, WebFetch" approved={true} />
                  <PolicyRow label="Write, Edit" approved={policy.trustLevel !== 'conservative'} />
                  <PolicyRow label="Task (subagents)" approved={policy.trustLevel !== 'conservative'} />
                  <PolicyRow label="Safe Bash commands" approved={policy.trustLevel === 'aggressive'} />
                  <PolicyRow label="Dangerous Bash (rm -rf, sudo)" approved={false} escalated />
                  <PolicyRow label="AskUserQuestion" approved={false} escalated />
                </div>
              </div>

              {/* Strategy modules */}
              <div>
                <p className="text-sm font-medium mb-2">Strategy Modules</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Additional security checks applied before trust level evaluation.
                </p>
                <div className="space-y-2">
                  <StrategyToggle
                    label="Workspace Scope"
                    description="Escalate file operations outside workspace root"
                    enabled={policy.strategies?.workspaceScope?.enabled ?? false}
                    onToggle={(v) => updatePolicy({
                      strategies: {
                        ...policy.strategies,
                        workspaceScope: {
                          enabled: v,
                          allowedPaths: policy.strategies?.workspaceScope?.allowedPaths ?? ['/tmp'],
                        },
                      },
                    })}
                  />
                  {policy.strategies?.workspaceScope?.enabled && (
                    <div className="ml-4 pl-3 border-l-2 border-border">
                      <label className="text-xs text-muted-foreground block mb-1">Extra allowed paths (one per line)</label>
                      <textarea
                        value={(policy.strategies?.workspaceScope?.allowedPaths ?? []).join('\n')}
                        onChange={(e) => updatePolicy({
                          strategies: {
                            ...policy.strategies,
                            workspaceScope: {
                              enabled: true,
                              allowedPaths: e.target.value.split('\n').map(p => p.trim()).filter(Boolean),
                            },
                          },
                        })}
                        className="w-full px-2 py-1 bg-secondary border border-border rounded text-xs font-mono h-16 resize-none focus:outline-none focus:border-primary"
                        placeholder="/tmp&#10;/var/folders"
                      />
                    </div>
                  )}

                  <StrategyToggle
                    label="Sensitive Files"
                    description="Escalate operations on .env, keys, credentials"
                    enabled={policy.strategies?.sensitiveFiles?.enabled ?? false}
                    onToggle={(v) => updatePolicy({
                      strategies: {
                        ...policy.strategies,
                        sensitiveFiles: {
                          enabled: v,
                          patterns: policy.strategies?.sensitiveFiles?.patterns ?? [],
                        },
                      },
                    })}
                  />

                  <StrategyToggle
                    label="Network Access"
                    description="Escalate Bash commands with curl, wget, ssh, git push"
                    enabled={policy.strategies?.networkAccess?.enabled ?? false}
                    onToggle={(v) => updatePolicy({
                      strategies: {
                        ...policy.strategies,
                        networkAccess: { enabled: v },
                      },
                    })}
                  />

                  <StrategyToggle
                    label="AI Analysis"
                    description="Use AI to analyze uncertain commands (slower)"
                    enabled={policy.strategies?.aiAnalysis?.enabled ?? false}
                    onToggle={(v) => updatePolicy({
                      strategies: {
                        ...policy.strategies,
                        aiAnalysis: { enabled: v },
                      },
                    })}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Save button */}
      {dirty && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}

function PolicyRow({ label, approved, escalated }: { label: string; approved: boolean; escalated?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      {escalated ? (
        <span className="text-amber-500">Asks you</span>
      ) : approved ? (
        <span className="text-green-500">Auto-approved</span>
      ) : (
        <span className="text-muted-foreground/60">Asks you</span>
      )}
    </div>
  );
}

function StrategyToggle({ label, description, enabled, onToggle }: {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary/30">
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        onClick={() => onToggle(!enabled)}
        className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${
          enabled ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
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
      {isGatewayConnected && discoveredBackends.filter(b => !b.isLocal).length > 0 && (
        <>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">
            Via Gateway
          </div>
          {discoveredBackends.filter(b => !b.isLocal).map((backend) => {
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
