import { useServerStore } from '../../stores/serverStore';
import { useGatewayStore, toGatewayServerId, shouldShowBackend } from '../../stores/gatewayStore';

export function ServerInfoPanel() {
  const { servers, activeServerId, connections } = useServerStore();
  const {
    isConnected: isGatewayConnected,
    discoveredBackends,
    currentInstanceId,
    showLocalBackend,
  } = useGatewayStore();

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
  const visibleGatewayBackends = discoveredBackends.filter(b => shouldShowBackend(b, currentInstanceId, showLocalBackend));

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
      {isGatewayConnected && visibleGatewayBackends.length > 0 && (
        <>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">
            Via Gateway
          </div>
          {visibleGatewayBackends.map((backend) => {
            const gwServerId = toGatewayServerId(backend.backendId);
            const isActive = activeServerId === gwServerId;
            const statusText = backend.online ? 'Online' : 'Offline';
            const statusColor = backend.online ? 'bg-success' : 'bg-muted-foreground';

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
