import { useEffect, useRef, useState } from 'react';
import { Bot, Monitor, ChevronRight } from 'lucide-react';
import { useGatewayStore } from '../stores/gatewayStore';
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useConnection } from '../contexts/ConnectionContext';
import type { BackendSnapshot } from '@my-claudia/shared';
import { useMobileRecoveryStore } from '../stores/mobileRecoveryStore';
import { getVisibleMobileBackends, isMobileGatewayConnected } from '../services/mobileConnectionState';

function shouldShowMobileDebug(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mobileDebug') === '1';
}

export function MobileSetup() {
  const {
    directGatewayUrl,
    directGatewaySecret,
    backendAuthStatus,
    setDirectGatewayConfig,
    setLastActiveBackend,
  } = useGatewayStore();
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeConnectionError = useFacadeStore((s) => s.connectionError);
  const backends = useFacadeStore((s) => s.backends);
  const currentInstanceId = useFacadeStore((s) => s.currentInstanceId);

  const { setActiveServer } = useServerStore();
  const { connectServer } = useConnection();

  const [gatewayUrl, setGatewayUrl] = useState(directGatewayUrl || '');
  const [gatewaySecret, setGatewaySecret] = useState(directGatewaySecret || '');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugVisible, setDebugVisible] = useState(() => shouldShowMobileDebug());
  const logoTapCountRef = useRef(0);
  const connectIntervalRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);

  const clearConnectTimers = () => {
    if (connectIntervalRef.current !== null) {
      window.clearInterval(connectIntervalRef.current);
      connectIntervalRef.current = null;
    }
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    setGatewayUrl(directGatewayUrl || '');
  }, [directGatewayUrl]);

  useEffect(() => {
    setGatewaySecret(directGatewaySecret || '');
  }, [directGatewaySecret]);

  const mobileRecoveryPhase = useMobileRecoveryStore((s) => s.phase);
  const mobileRecoveryError = useMobileRecoveryStore((s) => s.lastError);

  useEffect(() => {
    if (!connecting) return;

    if (facadeConnectionState === 'connected' && mobileRecoveryPhase !== 'recovering') {
      clearConnectTimers();
      setConnecting(false);
      setError(null);
      return;
    }

    if (facadeConnectionState === 'error' || mobileRecoveryPhase === 'error') {
      clearConnectTimers();
      setConnecting(false);
      setError(mobileRecoveryError || facadeConnectionError || 'Connection failed.');
    }
  }, [connecting, facadeConnectionState, mobileRecoveryError, mobileRecoveryPhase, facadeConnectionError]);

  useEffect(() => clearConnectTimers, []);

  const handleConnect = () => {
    const url = gatewayUrl.trim();
    const secret = gatewaySecret.trim();

    if (!url || !secret) {
      setError('Please enter both Gateway URL and Secret');
      return;
    }

    setError(null);
    setConnecting(true);
    useFacadeStore.setState({ connectionState: 'connecting', connectionError: null });

    setDirectGatewayConfig(url, secret);
    clearConnectTimers();

    connectIntervalRef.current = window.setInterval(() => {
      if (isMobileGatewayConnected(
        useFacadeStore.getState().connectionState,
        useMobileRecoveryStore.getState().phase,
      )) {
        setConnecting(false);
        clearConnectTimers();
      }
    }, 500);

    connectTimeoutRef.current = window.setTimeout(() => {
      if (!isMobileGatewayConnected(
        useFacadeStore.getState().connectionState,
        useMobileRecoveryStore.getState().phase,
      )) {
        setConnecting(false);
        setError('Connection timed out. Please check the URL and secret.');
      }
      clearConnectTimers();
    }, 15000);
  };

  const handleBackendSelect = (backend: BackendSnapshot) => {
    if (backend.runtimeState === 'offline') return;
    const serverId = backend.backendId;
    setActiveServer(serverId);
    setLastActiveBackend(serverId);
    connectServer(serverId);
  };

  const { showLocalBackend } = useGatewayStore();
  const isGatewayConnected = isMobileGatewayConnected(facadeConnectionState, mobileRecoveryPhase);
  const onlineBackends = getVisibleMobileBackends(
    backends,
    mobileRecoveryPhase,
    currentInstanceId,
    showLocalBackend,
  );
  const showDebug = debugVisible;

  const handleLogoTap = () => {
    logoTapCountRef.current += 1;
    if (logoTapCountRef.current >= 5) {
      logoTapCountRef.current = 0;
      setDebugVisible((visible) => !visible);
    }
  };

  // Phase 2: Gateway connected — show backend selection
  if (isGatewayConnected && onlineBackends.length > 0) {
    return (
      <div className="flex flex-col h-dvh bg-background text-foreground safe-top-pad safe-bottom-pad">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6">
            {/* Logo */}
            <div className="text-center">
              <button
                type="button"
                onClick={handleLogoTap}
                className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"
              >
                <Bot size={32} strokeWidth={1.5} className="text-primary" />
              </button>
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

            {showDebug && (
              <div
                data-testid="mobile-debug-panel"
                className="rounded-xl border border-border bg-card/70 p-3 text-left text-xs text-muted-foreground space-y-2"
              >
                <div className="font-medium text-foreground">Mobile Debug</div>
                <div>connectionState: {facadeConnectionState}</div>
                <div>connectionError: {facadeConnectionError || '-'}</div>
                <div>currentInstanceId: {currentInstanceId || '-'}</div>
                <div>showLocalBackend: {showLocalBackend ? 'true' : 'false'}</div>
                <div>backends: {backends.length}</div>
                <div>onlineBackends: {onlineBackends.length}</div>
                <div className="space-y-1">
                  {backends.map((backend) => (
                    <div key={backend.backendId} className="rounded-lg border border-border/70 px-2 py-1">
                      <div className="text-foreground">{backend.name} ({backend.backendId})</div>
                      <div>
                        online={String(backend.online)} runtime={backend.runtimeState} thisInstance={String(backend.isThisInstance)}
                      </div>
                      <div className="truncate">instanceId={backend.instanceId || '-'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Phase 1: Gateway setup form
  return (
    <div className="flex flex-col h-dvh bg-background text-foreground safe-top-pad safe-bottom-pad">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Logo */}
          <div className="text-center">
            <button
              type="button"
              onClick={handleLogoTap}
              className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"
            >
              <Bot size={32} strokeWidth={1.5} className="text-primary" />
            </button>
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

          {showDebug && (
            <div
              data-testid="mobile-debug-panel"
              className="rounded-xl border border-border bg-card/70 p-3 text-left text-xs text-muted-foreground space-y-2"
            >
              <div className="font-medium text-foreground">Mobile Debug</div>
              <div>connectionState: {facadeConnectionState}</div>
              <div>connectionError: {facadeConnectionError || '-'}</div>
              <div>currentInstanceId: {currentInstanceId || '-'}</div>
              <div>showLocalBackend: {showLocalBackend ? 'true' : 'false'}</div>
              <div>backends: {backends.length}</div>
              <div>onlineBackends: {onlineBackends.length}</div>
              <div className="space-y-1">
                {backends.map((backend) => (
                  <div key={backend.backendId} className="rounded-lg border border-border/70 px-2 py-1">
                    <div className="text-foreground">{backend.name} ({backend.backendId})</div>
                    <div>
                      online={String(backend.online)} runtime={backend.runtimeState} thisInstance={String(backend.isThisInstance)}
                    </div>
                    <div className="truncate">instanceId={backend.instanceId || '-'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
