import { useState, useEffect, useCallback } from 'react';
import { Bot, Monitor, ChevronRight, Terminal, RefreshCw, ExternalLink, Copy, Check, AlertCircle } from 'lucide-react';
import { useWslDiscovery, checkWslServerHealth } from '../hooks/useWslDiscovery';
import { useServerStore, type ConnectionStatus } from '../stores/serverStore';
import { useConnection } from '../contexts/ConnectionContext';
import { Command, open } from '@tauri-apps/plugin-shell';

type SetupPhase = 'checking' | 'no-wsl' | 'wsl-no-server' | 'server-ready' | 'manual' | 'connecting';

const DEFAULT_PORT = 3100;
const SETUP_SCRIPT_URL = 'https://raw.githubusercontent.com/zhvala/my-claudia/main/scripts/setup-wsl.sh';

export function WindowsSetup() {
  const {
    isChecking,
    wslAvailable,
    serverRunning,
    serverAddress,
    distros,
    error,
    runDiscovery,
  } = useWslDiscovery();

  const { setActiveServer, setLocalServerAddress } = useServerStore();
  const { connectServer } = useConnection();

  const [phase, setPhase] = useState<SetupPhase>('checking');
  const [manualAddress, setManualAddress] = useState(`localhost:${DEFAULT_PORT}`);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (serverAddress) {
      setManualAddress(serverAddress);
    }
  }, [serverAddress]);

  // Run discovery on mount
  useEffect(() => {
    runDiscovery();
  }, [runDiscovery]);

  // Update phase based on discovery results
  useEffect(() => {
    if (isChecking) {
      setPhase('checking');
      return;
    }

    if (wslAvailable === false) {
      setPhase('no-wsl');
      return;
    }

    if (wslAvailable && serverRunning) {
      setPhase('server-ready');
      return;
    }

    if (wslAvailable && !serverRunning) {
      setPhase('wsl-no-server');
      return;
    }
  }, [isChecking, wslAvailable, serverRunning]);

  // Poll for server when in wsl-no-server phase
  useEffect(() => {
    if (phase !== 'wsl-no-server' || polling) return;

    const pollInterval = setInterval(async () => {
      const running = await checkWslServerHealth();
      if (running) {
        clearInterval(pollInterval);
        setPolling(false);
        runDiscovery();
      }
    }, 3000);

    setPolling(true);
    return () => {
      clearInterval(pollInterval);
      setPolling(false);
    };
  }, [phase, runDiscovery]);

  const normalizeAddress = useCallback((rawAddress: string): string => {
    const trimmed = rawAddress.trim();
    if (!trimmed) {
      return `localhost:${DEFAULT_PORT}`;
    }

    if (trimmed.includes('://')) {
      return new URL(trimmed).host;
    }

    if (!trimmed.includes(':')) {
      return `${trimmed}:${DEFAULT_PORT}`;
    }

    return trimmed;
  }, []);

  const handleConnect = useCallback(async (address: string = `localhost:${DEFAULT_PORT}`) => {
    setConnecting(true);
    setConnectError(null);

    try {
      const normalizedAddress = normalizeAddress(address);

      // Reuse the local slot as an ad hoc direct connection target.
      setLocalServerAddress(normalizedAddress);

      // Connect to 'local' server (which now points to the normalized address)
      setActiveServer('local');
      connectServer('local');

      // Wait for connection with timeout
      let attempts = 0;
      const maxAttempts = 20; // 10 seconds
      const checkConnection = (): boolean | null => {
        attempts++;
        const connectionStatus: ConnectionStatus = useServerStore.getState().connectionStatus;
        if (connectionStatus === 'connected') {
          return true;
        }
        if (attempts >= maxAttempts) {
          return false;
        }
        return null; // Still waiting
      };

      // Poll for connection status
      await new Promise<void>((resolve, reject) => {
        const interval = setInterval(() => {
          const result = checkConnection();
          if (result === true) {
            clearInterval(interval);
            resolve();
          } else if (result === false) {
            clearInterval(interval);
            reject(new Error('Connection timed out'));
          }
        }, 500);
      });

      // Connection successful - component will unmount
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(false);
    }
  }, [connectServer, normalizeAddress, setActiveServer, setLocalServerAddress]);

  const handleManualConnect = useCallback(() => {
    const address = manualAddress.trim();
    if (!address) {
      setConnectError('Please enter a server address');
      return;
    }
    handleConnect(address);
  }, [manualAddress, handleConnect]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const [terminalError, setTerminalError] = useState<string | null>(null);

  const openTerminal = useCallback(async () => {
    setTerminalError(null);
    try {
      const command = Command.create('open-windows-terminal', ['wsl']);
      await command.execute();
    } catch {
      // Fallback: open a classic console and start WSL there.
      try {
        const command = Command.create('open-cmd-wsl', ['/c', 'wsl']);
        await command.execute();
      } catch {
        setTerminalError('Failed to open terminal. Please run "wsl" in Command Prompt or PowerShell manually.');
      }
    }
  }, []);

  const openMicrosoftStore = useCallback(async () => {
    try {
      await open('ms-windows-store://pdp/?productid=9P9TQF7MRM4R');
    } catch {
      // Fallback to web
      await open('https://www.microsoft.com/store/productId/9P9TQF7MRM4R');
    }
  }, []);

  const runningDistros = distros.filter(d => d.state === 'Running');

  // Phase: Checking WSL status
  if (phase === 'checking') {
    return (
      <div className="flex flex-col h-dvh bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Checking WSL status...</p>
          </div>
        </div>
      </div>
    );
  }

  // Phase: WSL not installed
  if (phase === 'no-wsl') {
    return (
      <div className="flex flex-col h-dvh bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Bot size={32} strokeWidth={1.5} className="text-primary" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Welcome to MyClaudia</h1>
              <p className="text-sm text-muted-foreground mt-1">
                WSL is required to run the backend server
              </p>
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="bg-muted/50 rounded-xl p-4 space-y-3">
              <p className="text-sm text-foreground font-medium">Install WSL:</p>
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
                Run this in PowerShell as Administrator, then restart your computer.
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
          </div>
        </div>
      </div>
    );
  }

  // Phase: WSL installed but server not running
  if (phase === 'wsl-no-server') {
    return (
      <div className="flex flex-col h-dvh bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Terminal size={32} strokeWidth={1.5} className="text-primary" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Start the Server</h1>
              <p className="text-sm text-muted-foreground mt-1">
                WSL is ready. Start the backend server to continue.
              </p>
            </div>

            {/* Show running distros */}
            {runningDistros.length > 0 && (
              <div className="bg-success/10 border border-success/30 rounded-lg p-3">
                <p className="text-xs text-success font-medium">
                  {runningDistros.length} WSL distro(s) running: {runningDistros.map(d => d.name).join(', ')}
                </p>
              </div>
            )}

            {/* Terminal error */}
            {terminalError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle size={16} className="text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{terminalError}</p>
              </div>
            )}

            <div className="bg-muted/50 rounded-xl p-4 space-y-3">
              <p className="text-sm text-foreground font-medium">Run in WSL:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background px-3 py-2 rounded-lg font-mono overflow-x-auto">
                  pnpm server:dev
                </code>
                <button
                  onClick={() => copyToClipboard('pnpm server:dev')}
                  className="p-2 hover:bg-background rounded-lg transition-colors flex-shrink-0"
                  title="Copy command"
                >
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} className="text-muted-foreground" />}
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                Or use the quick setup script:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background px-3 py-2 rounded-lg font-mono overflow-x-auto">
                  curl -sSL {SETUP_SCRIPT_URL} | bash
                </code>
                <button
                  onClick={() => copyToClipboard(`curl -sSL ${SETUP_SCRIPT_URL} | bash`)}
                  className="p-2 hover:bg-background rounded-lg transition-colors flex-shrink-0"
                  title="Copy command"
                >
                  <Copy size={16} className="text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={openTerminal}
                className="flex-1 py-3 border border-border hover:bg-muted rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
              >
                <Terminal size={16} />
                Open Terminal
              </button>
              <button
                onClick={runDiscovery}
                className="flex-1 py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw size={16} />
                Check Again
              </button>
            </div>

            {/* Manual connection option */}
            <button
              onClick={() => setPhase('manual')}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Or enter server address manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Phase: Server ready
  if (phase === 'server-ready') {
    return (
      <div className="flex flex-col h-dvh bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
                <Monitor size={32} strokeWidth={1.5} className="text-success" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Server Found</h1>
              <p className="text-sm text-muted-foreground mt-1">
                A server is running at {serverAddress || `localhost:${DEFAULT_PORT}`}
              </p>
            </div>

            {connectError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                <p className="text-sm text-destructive">{connectError}</p>
              </div>
            )}

            <button
              onClick={() => handleConnect()}
              disabled={connecting}
              className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {connecting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Connecting...
                </>
              ) : (
                <>
                  <ChevronRight size={16} />
                  Connect to Server
                </>
              )}
            </button>

            <button
              onClick={() => setPhase('manual')}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Use a different address
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Phase: Manual configuration
  if (phase === 'manual') {
    return (
      <div className="flex flex-col h-dvh bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Bot size={32} strokeWidth={1.5} className="text-primary" />
              </div>
              <h1 className="text-xl font-bold text-foreground">Manual Setup</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Enter the server address
              </p>
            </div>

            {connectError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                <p className="text-sm text-destructive">{connectError}</p>
              </div>
            )}

            <div className="space-y-4">
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
            </div>

            <button
              onClick={handleManualConnect}
              disabled={connecting || !manualAddress.trim()}
              className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-medium text-sm transition-colors disabled:opacity-50"
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

            <button
              onClick={() => runDiscovery()}
              className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Back to auto-discovery
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Phase: Connecting (should not reach here normally)
  return (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Connecting...</p>
        </div>
      </div>
    </div>
  );
}
