import { useState, useEffect, useCallback, useRef } from 'react';
import { Bot, Monitor, ChevronRight, Terminal, RefreshCw, ExternalLink, Copy, Check, AlertCircle, Globe, ArrowLeft } from 'lucide-react';
import { useWslDiscovery } from '../hooks/useWslDiscovery';
import { useServerStore, type ConnectionStatus } from '../stores/serverStore';
import { useGatewayStore, toGatewayServerId, shouldShowBackend } from '../stores/gatewayStore';
import { useConnection } from '../contexts/ConnectionContext';
import { open } from '@tauri-apps/plugin-shell';
import type { GatewayBackendInfo } from '@my-claudia/shared';

type SetupPath = 'choose' | 'wsl' | 'gateway' | 'manual';

const DEFAULT_PORT = 3100;

/** Spinner SVG used in buttons */
function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function WindowsSetup() {
  const { wslAvailable, distros, runDiscovery } = useWslDiscovery();
  const { wslServer, connectServer } = useConnection();
  const { setActiveServer, setLocalServerAddress } = useServerStore();

  const {
    isConnected: isGatewayConnected,
    discoveredBackends,
    backendAuthStatus,
    localBackendId,
    setDirectGatewayConfig,
    setLastActiveBackend,
    showLocalBackend,
  } = useGatewayStore();

  const [path, setPath] = useState<SetupPath>('choose');
  const [manualAddress, setManualAddress] = useState(`localhost:${DEFAULT_PORT}`);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Gateway form
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [gatewaySecret, setGatewaySecret] = useState('');
  const [gatewayConnecting, setGatewayConnecting] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);

  // Run WSL discovery on mount
  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

  // Auto-connect when WSL server becomes ready
  useEffect(() => {
    if (wslServer.status === 'ready' && wslServer.port) {
      handleConnect(`localhost:${wslServer.port}`);
    }
  }, [wslServer.status, wslServer.port]);

  // --- Connection helpers ---

  const normalizeAddress = useCallback((rawAddress: string): string => {
    const trimmed = rawAddress.trim();
    if (!trimmed) return `localhost:${DEFAULT_PORT}`;
    if (trimmed.includes('://')) return new URL(trimmed).host;
    if (!trimmed.includes(':')) return `${trimmed}:${DEFAULT_PORT}`;
    return trimmed;
  }, []);

  const handleConnect = useCallback(async (address: string = `localhost:${DEFAULT_PORT}`) => {
    setConnecting(true);
    setConnectError(null);

    try {
      const normalizedAddress = normalizeAddress(address);
      setLocalServerAddress(normalizedAddress);
      setActiveServer('local');
      connectServer('local');

      // Poll for connection
      let attempts = 0;
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          attempts++;
          const connectionStatus: ConnectionStatus = useServerStore.getState().connectionStatus;
          if (connectionStatus === 'connected') {
            clearInterval(interval);
            resolve();
          } else if (attempts >= 20) {
            clearInterval(interval);
            reject(new Error('Connection timed out'));
          }
        }, 500);
      });
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(false);
    }
  }, [connectServer, normalizeAddress, setActiveServer, setLocalServerAddress]);

  const handleGatewayConnect = useCallback(() => {
    const url = gatewayUrl.trim();
    const secret = gatewaySecret.trim();
    if (!url || !secret) {
      setGatewayError('Please enter both Gateway URL and Secret');
      return;
    }

    setGatewayError(null);
    setGatewayConnecting(true);
    setDirectGatewayConfig(url, secret);

    const checkInterval = setInterval(() => {
      if (useGatewayStore.getState().isConnected) {
        setGatewayConnecting(false);
        clearInterval(checkInterval);
      }
    }, 500);

    setTimeout(() => {
      clearInterval(checkInterval);
      if (!useGatewayStore.getState().isConnected) {
        setGatewayConnecting(false);
        setGatewayError('Connection timed out. Please check the URL and secret.');
      }
    }, 15000);
  }, [gatewayUrl, gatewaySecret, setDirectGatewayConfig]);

  const handleBackendSelect = useCallback((backend: GatewayBackendInfo) => {
    if (!backend.online) return;
    const serverId = toGatewayServerId(backend.backendId);
    setActiveServer(serverId);
    setLastActiveBackend(serverId);
    connectServer(serverId);
  }, [setActiveServer, setLastActiveBackend, connectServer]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const openMicrosoftStore = useCallback(async () => {
    try {
      await open('ms-windows-store://pdp/?productid=9P9TQF7MRM4R');
    } catch {
      await open('https://www.microsoft.com/store/productId/9P9TQF7MRM4R');
    }
  }, []);

  const runningDistros = distros.filter(d => d.state === 'Running');
  const onlineBackends = discoveredBackends.filter(
    b => b.online && shouldShowBackend(b, localBackendId, showLocalBackend)
  );

  // --- Layout wrapper ---
  const PageWrapper = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      <div className="safe-top-spacer bg-background flex-shrink-0" data-tauri-drag-region />
      <div className="flex-1 flex items-center justify-center p-6" data-tauri-drag-region>
        {children}
      </div>
    </div>
  );

  // --- Back button ---
  const BackButton = ({ onClick }: { onClick: () => void }) => (
    <button
      onClick={onClick}
      className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
    >
      <ArrowLeft size={14} />
      Back
    </button>
  );

  // ============================================================
  // PATH: Choose (default landing)
  // ============================================================
  if (path === 'choose') {
    return (
      <PageWrapper>
        <div className="w-full max-w-md space-y-6">
          {/* Logo */}
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Bot size={32} strokeWidth={1.5} className="text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Welcome to MyClaudia</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Choose how to connect to the backend server
            </p>
          </div>

          {/* Two cards side by side */}
          <div className="grid grid-cols-2 gap-3">
            {/* WSL Local Server */}
            <button
              onClick={() => setPath('wsl')}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border bg-card hover:bg-muted hover:border-primary/50 transition-all text-center group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <Terminal size={24} strokeWidth={1.5} className="text-primary" />
              </div>
              <div>
                <div className="font-medium text-sm text-foreground">WSL Server</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Run locally in WSL
                </div>
              </div>
              {wslAvailable && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">
                  WSL Ready
                </span>
              )}
            </button>

            {/* Gateway Remote Server */}
            <button
              onClick={() => setPath('gateway')}
              className="flex flex-col items-center gap-3 p-5 rounded-xl border border-border bg-card hover:bg-muted hover:border-primary/50 transition-all text-center group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <Globe size={24} strokeWidth={1.5} className="text-primary" />
              </div>
              <div>
                <div className="font-medium text-sm text-foreground">Gateway</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Connect to remote server
                </div>
              </div>
            </button>
          </div>

          {/* Manual option */}
          <button
            onClick={() => setPath('manual')}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Or enter server address manually
          </button>
        </div>
      </PageWrapper>
    );
  }

  // ============================================================
  // PATH: WSL Server setup
  // ============================================================
  if (path === 'wsl') {
    // Sub-case: WSL not available
    if (wslAvailable === false) {
      return (
        <PageWrapper>
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Bot size={32} strokeWidth={1.5} className="text-primary" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Install WSL</h1>
              <p className="text-sm text-muted-foreground mt-1">
                WSL is required to run the local server
              </p>
            </div>

            <div className="bg-muted/50 rounded-xl p-4 space-y-3">
              <p className="text-sm text-foreground font-medium">Run in PowerShell (Admin):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background px-3 py-2 rounded-lg font-mono">
                  wsl --install
                </code>
                <button
                  onClick={() => copyToClipboard('wsl --install')}
                  className="p-2 hover:bg-background rounded-lg transition-colors"
                  title="Copy command"
                >
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} className="text-muted-foreground" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Restart your computer after installation.
              </p>
            </div>

            <button
              onClick={openMicrosoftStore}
              className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink size={16} />
              Open Microsoft Store
            </button>

            <button
              onClick={runDiscovery}
              className="w-full py-3 border border-border hover:bg-muted rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw size={16} />
              Check Again
            </button>

            <BackButton onClick={() => setPath('choose')} />
          </div>
        </PageWrapper>
      );
    }

    // Sub-case: WSL available — show deploy + start flow
    const isWslBusy = wslServer.status === 'checking' || wslServer.status === 'deploying' || wslServer.status === 'starting';

    return (
      <PageWrapper>
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Terminal size={32} strokeWidth={1.5} className="text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground">WSL Server</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Deploy and start the server in WSL
            </p>
          </div>

          {/* Running distros */}
          {runningDistros.length > 0 && (
            <div className="bg-success/10 border border-success/30 rounded-lg p-3">
              <p className="text-xs text-success font-medium">
                WSL: {runningDistros.map(d => d.name).join(', ')}
              </p>
            </div>
          )}

          {/* Error */}
          {wslServer.error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle size={16} className="text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{wslServer.error}</p>
            </div>
          )}

          {/* Terminal output */}
          {wslServer.outputLines.length > 0 && (
            <TerminalOutput lines={wslServer.outputLines} />
          )}

          {/* Start button */}
          <button
            onClick={wslServer.start}
            disabled={isWslBusy || connecting}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isWslBusy ? (
              <>
                <Spinner />
                {wslServer.status === 'checking' && 'Checking...'}
                {wslServer.status === 'deploying' && 'Deploying...'}
                {wslServer.status === 'starting' && 'Starting...'}
              </>
            ) : connecting ? (
              <>
                <Spinner />
                Connecting...
              </>
            ) : wslServer.status === 'error' ? (
              <>
                <RefreshCw size={16} />
                Retry
              </>
            ) : (
              <>
                <ChevronRight size={16} />
                Start Server
              </>
            )}
          </button>

          <BackButton onClick={() => setPath('choose')} />
        </div>
      </PageWrapper>
    );
  }

  // ============================================================
  // PATH: Gateway
  // ============================================================
  if (path === 'gateway') {
    // Sub-case: Gateway connected, show backend selection
    if (isGatewayConnected && onlineBackends.length > 0) {
      return (
        <PageWrapper>
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Globe size={32} strokeWidth={1.5} className="text-primary" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Select a Server</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Choose a backend to connect to
              </p>
            </div>

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

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span>Gateway connected</span>
            </div>

            <BackButton onClick={() => setPath('choose')} />
          </div>
        </PageWrapper>
      );
    }

    // Sub-case: Gateway form
    return (
      <PageWrapper>
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Globe size={32} strokeWidth={1.5} className="text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Gateway Connection</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Connect to a remote server via gateway
            </p>
          </div>

          {gatewayError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <p className="text-sm text-destructive">{gatewayError}</p>
            </div>
          )}

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
                disabled={gatewayConnecting}
                className="w-full px-4 py-3 border border-border rounded-xl bg-input text-foreground text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
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
                disabled={gatewayConnecting}
                className="w-full px-4 py-3 border border-border rounded-xl bg-input text-foreground text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
              />
            </div>
          </div>

          <button
            onClick={handleGatewayConnect}
            disabled={gatewayConnecting || !gatewayUrl.trim() || !gatewaySecret.trim()}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium text-sm transition-colors disabled:opacity-50"
          >
            {gatewayConnecting ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
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

          <BackButton onClick={() => setPath('choose')} />
        </div>
      </PageWrapper>
    );
  }

  // ============================================================
  // PATH: Manual address
  // ============================================================
  if (path === 'manual') {
    return (
      <PageWrapper>
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Bot size={32} strokeWidth={1.5} className="text-primary" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Manual Connection</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Enter the server address directly
            </p>
          </div>

          {connectError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <p className="text-sm text-destructive">{connectError}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Server Address
            </label>
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="localhost:3100 or 192.168.1.100:3100"
              disabled={connecting}
              className="w-full px-4 py-3 border border-border rounded-xl bg-input text-foreground text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
            />
          </div>

          <button
            onClick={() => handleConnect(manualAddress)}
            disabled={connecting || !manualAddress.trim()}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium text-sm transition-colors disabled:opacity-50"
          >
            {connecting ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
                Connecting...
              </span>
            ) : (
              'Connect'
            )}
          </button>

          <BackButton onClick={() => setPath('choose')} />
        </div>
      </PageWrapper>
    );
  }

  // Fallback
  return (
    <PageWrapper>
      <div className="text-center">
        <Spinner className="w-10 h-10 mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </PageWrapper>
  );
}

/**
 * Scrollable terminal-like output display for WSL server deploy/start progress.
 */
function TerminalOutput({ lines }: { lines: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div
      ref={scrollRef}
      className="bg-[#1a1a2e] rounded-xl p-3 max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed"
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            line.includes('ERROR')
              ? 'text-red-400'
              : line.includes('Done') || line.includes('Ready') || line.includes('complete')
                ? 'text-green-400'
                : 'text-gray-300'
          }
        >
          {line}
        </div>
      ))}
    </div>
  );
}
