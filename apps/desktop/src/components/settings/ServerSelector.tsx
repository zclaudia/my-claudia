import { useState } from 'react';
import { useServerStore } from '../../stores/serverStore';
import { useGatewayStore, shouldShowNonCurrentInstanceBackend } from '../../stores/gatewayStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useIsMobile } from '../../hooks/useMediaQuery';
import type { BackendSnapshot } from '@my-claudia/shared';
import type { BackendRecoveryViewState } from '../../stores/recoveryStore';
import {
  getMobileBackendViewState,
  isMobileGatewayConnected,
  type MobileBackendViewState,
} from '../../services/mobileConnectionState';

function formatLatency(latencyMs?: number | null): string | null {
  if (latencyMs == null) return null;
  return `${latencyMs}ms`;
}

export function ServerSelector() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const connections = useServerStore((s) => s.connections);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const gatewayUrl = useGatewayStore((s) => s.gatewayUrl);
  const gatewaySecret = useGatewayStore((s) => s.gatewaySecret);
  const setLastActiveBackend = useGatewayStore((s) => s.setLastActiveBackend);
  const showLocalBackend = useGatewayStore((s) => s.showLocalBackend);

  const { connectServer } = useConnection();
  const isMobile = useIsMobile();

  const [isOpen, setIsOpen] = useState(false);

  const backends = useFacadeStore((s) => s.backends);
  const localBackendId = useFacadeStore((s) => s.localBackendId);
  const currentInstanceId = useFacadeStore((s) => s.currentInstanceId);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const activeBackend = backends.find(b => b.backendId === activeServerId);
  const fallbackBackend =
    activeBackend
    || (localBackendId ? backends.find((b) => b.backendId === localBackendId) : null)
    || backends.find((b) => b.isThisInstance)
    || null;
  const displayedBackend = activeBackend || fallbackBackend;
  const displayedBackendId = displayedBackend?.backendId ?? activeServerId ?? null;
  const getViewState = (backendId: string | null | undefined): BackendRecoveryViewState | MobileBackendViewState => (
    getMobileBackendViewState(backendId, facadeConnectionState, backends)
  );
  const activeRecoveryState = getViewState(displayedBackendId);
  const activeRecoveryError: string | null = null;
  const isGatewayReady = isMobileGatewayConnected(facadeConnectionState);
  const isGatewayConfigured = !!gatewayUrl && !!gatewaySecret;
  // Show all backends in the dropdown. When the active server is remote,
  // the local backend must be visible so the user can switch back.
  const isActiveRemote = activeServerId && localBackendId && activeServerId !== localBackendId;
  const effectiveShowLocal = showLocalBackend || !!isActiveRemote;
  const remoteBackends = backends.filter(b => shouldShowNonCurrentInstanceBackend(b, currentInstanceId, effectiveShowLocal));

  const handleBackendClick = (backend: BackendSnapshot) => {
    if (getViewState(backend.backendId) === 'offline') return;
    const serverId = backend.backendId;
    setActiveServer(serverId);
    connectServer(serverId);
    // On mobile, persist the last active backend
    if (isMobile) {
      setLastActiveBackend(serverId);
    }
    setIsOpen(false);
  };

  const getStatusColor = (viewState: BackendRecoveryViewState | MobileBackendViewState) => {
    switch (viewState) {
      case 'ready':
        return 'bg-success';
      case 'transport_reconnecting':
      case 'backend_subscribing':
      case 'data_syncing':
      case 'session_syncing':
        return 'bg-warning animate-pulse';
      case 'error':
        return 'bg-destructive';
      case 'backend_visible':
        return 'bg-warning';
      case 'offline':
      default:
        return 'bg-muted-foreground';
    }
  };

  const getStatusText = (viewState: BackendRecoveryViewState | MobileBackendViewState) => {
    switch (viewState) {
      case 'ready':
        return 'Connected';
      case 'transport_reconnecting':
        return 'Reconnecting...';
      case 'backend_subscribing':
        return 'Subscribing...';
      case 'data_syncing':
        return 'Refreshing sessions...';
      case 'session_syncing':
        return 'Recovering session...';
      case 'backend_visible':
        return 'Available';
      case 'error':
        return activeRecoveryError || 'Error';
      case 'offline':
      default:
        return 'Disconnected';
    }
  };

  return (
    <div className="relative">
      {/* Current Server Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary hover:bg-muted transition-colors"
        data-testid="server-selector"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(activeRecoveryState)}`} />
        <span className="flex-1 min-w-0 text-left text-sm truncate">
          {displayedBackend?.name || (isMobile ? 'Select Server' : 'No Server')}
        </span>
        <svg
          className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="fixed inset-x-2 top-14 md:absolute md:inset-x-auto md:top-full md:left-0 mt-1 md:w-72 bg-card border border-border rounded-lg shadow-xl z-[60]">
          {/* Status */}
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2 text-sm">
              <span className={`w-2 h-2 rounded-full ${getStatusColor(activeRecoveryState)}`} />
              <span className="text-muted-foreground" data-testid="connection-status">{getStatusText(activeRecoveryState)}</span>
            </div>
          </div>

          {/* Gateway Section */}
          <div>
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider bg-secondary/50 flex items-center justify-between">
              <span>{isMobile ? 'Servers' : 'Gateway'}</span>
              {isGatewayConfigured && (
                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    isGatewayReady
                      ? 'bg-success'
                      : 'bg-destructive'
                  }`} />
                  <span className="text-[10px] normal-case font-normal">
                    {isGatewayReady
                      ? 'Connected'
                      : 'Disconnected'}
                  </span>
                </div>
              )}
            </div>

            {!isGatewayConfigured ? (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                {isMobile ? 'Gateway not configured' : 'Configure in Settings > Gateway'}
              </div>
            ) : isGatewayReady && remoteBackends.length > 0 ? (
              <div className="max-h-48 overflow-y-auto">
                {(() => {
                  const sameDevice = remoteBackends.filter(b => b.isThisDevice);
                  const remote = remoteBackends.filter(b => !b.isThisDevice);
                  const renderItem = (backend: BackendSnapshot) => (
                    <GatewayBackendItem
                      key={backend.backendId}
                      backend={backend}
                      isActive={activeServerId === backend.backendId}

                      latencyMs={connections[backend.backendId]?.latencyMs}
                      recoveryViewState={getViewState(backend.backendId)}
                      onClick={() => handleBackendClick(backend)}

                    />
                  );
                  // Only show group headers when there are items in both groups
                  const showGroups = sameDevice.length > 0 && remote.length > 0;
                  return (
                    <>
                      {showGroups && sameDevice.length > 0 && (
                        <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">This Device</div>
                      )}
                      {sameDevice.map(renderItem)}
                      {showGroups && remote.length > 0 && (
                        <div className="px-3 py-1 text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">Remote</div>
                      )}
                      {remote.map(renderItem)}
                    </>
                  );
                })()}
              </div>
            ) : isGatewayReady ? (
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
          className="fixed inset-0 z-[55]"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

function GatewayBackendItem({
  backend,
  isActive,
  latencyMs,
  recoveryViewState,
  onClick,
}: {
  backend: BackendSnapshot;
  isActive: boolean;
  latencyMs?: number | null;
  recoveryViewState: BackendRecoveryViewState | MobileBackendViewState;
  onClick: () => void;
}) {
  const isReachable = recoveryViewState !== 'offline';
  const statusColor = recoveryViewState === 'ready'
    ? 'bg-success'
    : ['transport_reconnecting', 'backend_subscribing', 'data_syncing', 'session_syncing'].includes(recoveryViewState)
    ? 'bg-warning animate-pulse'
    : recoveryViewState === 'backend_visible'
    ? 'bg-warning'
    : recoveryViewState === 'error'
    ? 'bg-destructive'
    : 'bg-muted-foreground';
  const isNonProdChannel = backend.channel && backend.channel !== 'prod';

  const offlineLabel = (() => {
    switch (recoveryViewState) {
      case 'backend_subscribing': return 'Subscribing';
      case 'data_syncing': return 'Syncing';
      case 'backend_visible': return 'Idle';
      case 'error': return 'Error';
      default: return 'Offline';
    }
  })();

  return (
    <div
      className={`px-3 py-2 hover:bg-muted cursor-pointer ${isActive ? 'bg-muted' : ''} ${!isReachable ? 'opacity-50' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
        <span className="text-sm truncate flex-1 min-w-0">{backend.name}</span>
        {isNonProdChannel && (
          <span className="px-1 py-0 text-[10px] rounded border border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/5 flex-shrink-0">
            {backend.channel!.charAt(0).toUpperCase() + backend.channel!.slice(1)}
          </span>
        )}
        {formatLatency(latencyMs) && (
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {formatLatency(latencyMs)}
          </span>
        )}
        {isActive && (
          <span className="px-1.5 py-0.5 bg-primary/20 text-primary text-xs rounded flex-shrink-0">
            Active
          </span>
        )}
        {!isReachable && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {offlineLabel}
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground truncate ml-4 mt-0.5">
        {backend.backendId}
      </div>
    </div>
  );
}
