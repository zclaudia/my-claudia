import { useState } from 'react';
import { useServerStore, type ServerConnection } from '../stores/serverStore';
import { useGatewayStore, toGatewayServerId } from '../stores/gatewayStore';
import { useConnection } from '../contexts/ConnectionContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import type { BackendServer, GatewayBackendInfo } from '@my-claudia/shared';

export function ServerSelector() {
  const {
    servers,
    activeServerId,
    connections,
    connectionStatus,
    connectionError,
    setActiveServer
  } = useServerStore();

  const {
    gatewayUrl,
    gatewaySecret,
    isConnected: isGatewayConnected,
    discoveredBackends,
    setLastActiveBackend,
    toggleBackendSubscription,
    isBackendSubscribed,
  } = useGatewayStore();

  const { connectServer } = useConnection();
  const isMobile = useIsMobile();

  const [isOpen, setIsOpen] = useState(false);

  const directServers = servers.filter(s => s.connectionMode !== 'gateway');
  const activeServer = useServerStore.getState().getActiveServer();
  const isGatewayConfigured = !!gatewayUrl && !!gatewaySecret;
  const remoteBackends = discoveredBackends.filter(b => !b.isLocal);

  const handleServerSelect = (serverId: string) => {
    setActiveServer(serverId);
    setIsOpen(false);
  };

  const handleBackendClick = (backend: GatewayBackendInfo) => {
    if (!backend.online) return;
    const serverId = toGatewayServerId(backend.backendId);
    setActiveServer(serverId);
    connectServer(serverId);
    // On mobile, persist the last active backend
    if (isMobile) {
      setLastActiveBackend(serverId);
    }
    setIsOpen(false);
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-success';
      case 'connecting':
        return 'bg-warning animate-pulse';
      case 'error':
        return 'bg-destructive';
      default:
        return 'bg-muted-foreground';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return connectionError || 'Error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <div className="relative">
      {/* Current Server Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary hover:bg-muted transition-colors"
        data-testid="server-selector"
      >
        <span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
        <span className="text-sm truncate max-w-[150px]">
          {activeServer?.name || (isMobile ? 'Select Server' : 'No Server')}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="fixed inset-x-2 top-14 md:absolute md:inset-x-auto md:top-full md:left-0 mt-1 md:w-72 bg-card border border-border rounded-lg shadow-xl z-50">
          {/* Status */}
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
              <span className="text-muted-foreground" data-testid="connection-status">{getStatusText()}</span>
            </div>
          </div>

          {/* Direct Servers — hidden on mobile */}
          {!isMobile && (
            <div className="max-h-40 overflow-y-auto">
              {directServers.map((server) => (
                <ServerItem
                  key={server.id}
                  server={server}
                  isActive={server.id === activeServerId}
                  connection={connections[server.id]}
                  onSelect={() => handleServerSelect(server.id)}
                />
              ))}
            </div>
          )}

          {/* Gateway Section */}
          <div className={isMobile ? '' : 'border-t border-border'}>
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-secondary/50 flex items-center justify-between">
              <span>{isMobile ? 'Servers' : 'Gateway'}</span>
              {isGatewayConfigured && (
                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isGatewayConnected ? 'bg-success' : 'bg-destructive'}`} />
                  <span className="text-[10px] normal-case font-normal">
                    {isGatewayConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              )}
            </div>

            {!isGatewayConfigured ? (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                {isMobile ? 'Gateway not configured' : 'Configure in Settings > Gateway'}
              </div>
            ) : isGatewayConnected && remoteBackends.length > 0 ? (
              <div className="max-h-40 overflow-y-auto">
                {remoteBackends.map((backend) => (
                  <GatewayBackendItem
                    key={backend.backendId}
                    backend={backend}
                    isActive={activeServerId === toGatewayServerId(backend.backendId)}
                    isSubscribed={isBackendSubscribed(backend.backendId)}
                    onClick={() => handleBackendClick(backend)}
                    onToggleSubscription={() => toggleBackendSubscription(backend.backendId)}
                  />
                ))}
              </div>
            ) : isGatewayConnected ? (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                No backends available
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                Connecting to gateway...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

function GatewayBackendItem({
  backend,
  isActive,
  isSubscribed,
  onClick,
  onToggleSubscription
}: {
  backend: GatewayBackendInfo;
  isActive: boolean;
  isSubscribed: boolean;
  onClick: () => void;
  onToggleSubscription: () => void;
}) {
  const statusColor = backend.online ? 'bg-success' : 'bg-muted-foreground';

  return (
    <div
      className={`px-3 py-2 hover:bg-muted cursor-pointer ${isActive ? 'bg-muted' : ''} ${!backend.online ? 'opacity-50' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
        <span className="text-sm truncate flex-1 min-w-0">{backend.name}</span>
        {isActive && (
          <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded flex-shrink-0">
            Active
          </span>
        )}
        {!backend.online && (
          <span className="text-xs text-muted-foreground flex-shrink-0">Offline</span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSubscription(); }}
          className={`p-1 rounded transition-colors flex-shrink-0 ${
            isSubscribed
              ? 'text-primary hover:text-primary/70'
              : 'text-muted-foreground/30 hover:text-muted-foreground/60'
          }`}
          title={isSubscribed ? 'Subscribed to notifications (click to unsubscribe)' : 'Not subscribed (click to subscribe)'}
        >
          <svg className="w-3.5 h-3.5" fill={isSubscribed ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </button>
      </div>
      <div className="text-xs text-muted-foreground truncate ml-4 mt-0.5">
        {backend.backendId}
      </div>
    </div>
  );
}

function ServerItem({
  server,
  isActive,
  connection,
  onSelect
}: {
  server: BackendServer;
  isActive: boolean;
  connection?: ServerConnection;
  onSelect: () => void;
}) {
  const getConnectionStatusColor = () => {
    switch (connection?.status) {
      case 'connected':
        return 'bg-success';
      case 'connecting':
        return 'bg-warning animate-pulse';
      case 'error':
        return 'bg-destructive';
      default:
        return 'bg-muted-foreground';
    }
  };

  const isConnected = connection?.status === 'connected';
  const isConnecting = connection?.status === 'connecting';

  return (
    <div
      className={`px-3 py-2 hover:bg-muted cursor-pointer ${isActive ? 'bg-muted' : ''}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getConnectionStatusColor()}`} />
        <span className="text-sm font-medium truncate flex-1 min-w-0">{server.name}</span>
        {server.isDefault && (
          <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded flex-shrink-0">
            Default
          </span>
        )}
        {isConnected && (
          <span className="px-1.5 py-0.5 bg-success/20 text-success text-xs rounded flex-shrink-0">
            Connected
          </span>
        )}
        {isConnecting && (
          <span className="px-1.5 py-0.5 bg-warning/20 text-warning text-xs rounded flex-shrink-0 animate-pulse">
            Connecting
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground truncate ml-4 mt-0.5">
        {server.address}
      </div>
    </div>
  );
}
