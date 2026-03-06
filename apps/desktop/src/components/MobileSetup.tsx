import { useState } from 'react';
import { Bot, Monitor, ChevronRight } from 'lucide-react';
import { useGatewayStore, toGatewayServerId, shouldShowBackend } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { useConnection } from '../contexts/ConnectionContext';
import type { GatewayBackendInfo } from '@my-claudia/shared';

export function MobileSetup() {
  const {
    isConnected: isGatewayConnected,
    discoveredBackends,
    backendAuthStatus,
    localBackendId,
    setDirectGatewayConfig,
    setLastActiveBackend,
  } = useGatewayStore();

  const { setActiveServer } = useServerStore();
  const { connectServer } = useConnection();

  const [gatewayUrl, setGatewayUrl] = useState('');
  const [gatewaySecret, setGatewaySecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = () => {
    const url = gatewayUrl.trim();
    const secret = gatewaySecret.trim();

    if (!url || !secret) {
      setError('Please enter both Gateway URL and Secret');
      return;
    }

    setError(null);
    setConnecting(true);

    // Save direct config (persisted) and set runtime values
    setDirectGatewayConfig(url, secret);

    // The useGatewayConnection hook will pick up the new values
    // and create the transport automatically.
    // We give it a moment, then check connection status via polling.
    const checkInterval = setInterval(() => {
      const state = useGatewayStore.getState();
      if (state.isConnected) {
        setConnecting(false);
        clearInterval(checkInterval);
      }
    }, 500);

    // Timeout after 15 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      if (!useGatewayStore.getState().isConnected) {
        setConnecting(false);
        setError('Connection timed out. Please check the URL and secret.');
      }
    }, 15000);
  };

  const handleBackendSelect = (backend: GatewayBackendInfo) => {
    if (!backend.online) return;
    const serverId = toGatewayServerId(backend.backendId);
    setActiveServer(serverId);
    setLastActiveBackend(serverId);
    connectServer(serverId);
  };

  const { showLocalBackend } = useGatewayStore();
  const onlineBackends = discoveredBackends.filter(
    b => b.online && shouldShowBackend(b, localBackendId, showLocalBackend)
  );

  // Phase 2: Gateway connected — show backend selection
  if (isGatewayConnected && onlineBackends.length > 0) {
    return (
      <div className="flex flex-col h-screen bg-background text-foreground safe-top-pad safe-bottom-pad">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6">
            {/* Logo */}
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Bot size={32} strokeWidth={1.5} className="text-primary" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Select a Server</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Choose a backend to connect to
              </p>
            </div>

            {/* Backend list */}
            <div className="space-y-2">
              {onlineBackends.map((backend) => {
                const authStatus = backendAuthStatus[backend.backendId];
                const isAuthenticating = authStatus === 'pending';

                return (
                  <button
                    key={backend.backendId}
                    onClick={() => handleBackendSelect(backend)}
                    disabled={isAuthenticating}
                    className="w-full flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-left disabled:opacity-50"
                  >
                    <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
                      <Monitor size={20} strokeWidth={1.75} className="text-success" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-foreground truncate">
                        {backend.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {isAuthenticating ? 'Connecting...' : backend.backendId}
                      </div>
                    </div>
                    <ChevronRight size={20} strokeWidth={1.75} className="text-muted-foreground flex-shrink-0" />
                  </button>
                );
              })}
            </div>

            {/* Connection info */}
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span>Gateway connected</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Phase 1: Gateway setup form
  return (
    <div className="flex flex-col h-screen bg-background text-foreground safe-top-pad safe-bottom-pad">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Logo */}
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Bot size={32} strokeWidth={1.5} className="text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground">MyClaudia</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Connect to your server via Gateway
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Gateway URL
              </label>
              <input
                type="text"
                value={gatewayUrl}
                onChange={(e) => setGatewayUrl(e.target.value)}
                placeholder="http://gateway.example.com:3200"
                disabled={connecting}
                className="w-full px-4 py-3 border border-border rounded-xl
                         bg-input text-foreground text-sm
                         placeholder:text-muted-foreground
                         focus:ring-2 focus:ring-primary focus:border-transparent
                         disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Gateway Secret
              </label>
              <input
                type="password"
                value={gatewaySecret}
                onChange={(e) => setGatewaySecret(e.target.value)}
                placeholder="Enter gateway secret"
                disabled={connecting}
                className="w-full px-4 py-3 border border-border rounded-xl
                         bg-input text-foreground text-sm
                         placeholder:text-muted-foreground
                         focus:ring-2 focus:ring-primary focus:border-transparent
                         disabled:opacity-50"
              />
            </div>
          </div>

          {/* Connect button */}
          <button
            onClick={handleConnect}
            disabled={connecting || !gatewayUrl.trim() || !gatewaySecret.trim()}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl
                     font-medium text-sm transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Connecting...
              </span>
            ) : (
              'Connect'
            )}
          </button>

          {/* Waiting for backends */}
          {isGatewayConnected && onlineBackends.length === 0 && (
            <div className="text-center text-sm text-muted-foreground">
              <p>Gateway connected. Waiting for backends...</p>
              <p className="text-xs mt-1">Make sure your server is running and connected to the gateway.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
