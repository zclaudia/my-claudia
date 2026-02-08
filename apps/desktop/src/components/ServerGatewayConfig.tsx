import { useState, useEffect } from 'react';
import {
  getServerGatewayConfig,
  updateServerGatewayConfig,
  getServerGatewayStatus,
  connectServerToGateway,
  disconnectServerFromGateway
} from '../services/api';
import type { ServerGatewayConfig as GatewayConfig, ServerGatewayStatus } from '@my-claudia/shared';

export function ServerGatewayConfig() {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [status, setStatus] = useState<ServerGatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [gatewaySecret, setGatewaySecret] = useState('');
  const [backendName, setBackendName] = useState('');
  const [registerAsBackend, setRegisterAsBackend] = useState(true);
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  // Poll status every 5 seconds when enabled
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [enabled]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const [configData, statusData] = await Promise.all([
        getServerGatewayConfig(),
        getServerGatewayStatus()
      ]);

      setConfig(configData);
      setStatus(statusData);

      // Update form state
      setEnabled(configData.enabled);
      setGatewayUrl(configData.gatewayUrl || '');
      setBackendName(configData.backendName || '');
      setRegisterAsBackend(configData.registerAsBackend !== false);
      setProxyUrl(configData.proxyUrl || '');
      setProxyUsername(configData.proxyUsername || '');
      // Don't set secrets from API (they're masked)

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  };

  const loadStatus = async () => {
    try {
      const statusData = await getServerGatewayStatus();
      setStatus(statusData);
    } catch (err) {
      console.error('Failed to load status:', err);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const updates: any = {
        enabled,
        gatewayUrl: gatewayUrl.trim(),
        backendName: backendName.trim(),
        registerAsBackend
      };

      // Only include secret if it's been changed
      if (gatewaySecret.trim() && gatewaySecret !== '********') {
        updates.gatewaySecret = gatewaySecret.trim();
      }

      // Add proxy settings if provided
      if (proxyUrl.trim()) {
        updates.proxyUrl = proxyUrl.trim();
        if (proxyUsername.trim()) {
          updates.proxyUsername = proxyUsername.trim();
        }
        if (proxyPassword.trim() && proxyPassword !== '********') {
          updates.proxyPassword = proxyPassword.trim();
        }
      } else {
        // Clear proxy settings if URL is empty
        updates.proxyUrl = null;
        updates.proxyUsername = null;
        updates.proxyPassword = null;
      }

      const updated = await updateServerGatewayConfig(updates);
      setConfig(updated);

      // Reload status after save
      await loadStatus();

      alert('Gateway configuration saved successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    try {
      setSaving(true);
      setError(null);
      await connectServerToGateway();
      await loadStatus();
      alert('Connecting to gateway...');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setSaving(true);
      setError(null);
      await disconnectServerFromGateway();
      await loadStatus();
      alert('Disconnected from gateway');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2 text-foreground">
          Gateway Configuration
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Connect your server to a Gateway for remote access and to discover other backends.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Status Display */}
      {status && (
        <div className="bg-muted rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Status:</span>
            <span
              className={`text-sm px-2 py-1 rounded ${
                status.connected
                  ? 'bg-success/20 text-success'
                  : status.enabled
                  ? 'bg-warning/20 text-warning'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {status.connected ? 'Connected' : status.enabled ? 'Connecting...' : 'Disabled'}
            </span>
          </div>
          {status.backendId && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Backend ID:</span>
              <span className="text-sm font-mono text-muted-foreground">{status.backendId}</span>
            </div>
          )}
        </div>
      )}

      {/* Discovered Backends */}
      {status?.connected && status.discoveredBackends && status.discoveredBackends.length > 0 && (
        <div className="bg-muted rounded-lg p-3 space-y-2">
          <h4 className="text-sm font-semibold text-foreground">
            Discovered Backends ({status.discoveredBackends.length})
          </h4>
          {status.discoveredBackends.map((b) => (
            <div key={b.backendId} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${b.online ? 'bg-success' : 'bg-muted-foreground'}`} />
                <span className="text-foreground">{b.name}</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">{b.backendId}</span>
            </div>
          ))}
        </div>
      )}

      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          Enable Gateway Connection
        </label>
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Register as Backend Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-foreground">
            Register as Backend
          </label>
          <p className="text-xs text-muted-foreground">
            Make this server available for other clients through the gateway
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRegisterAsBackend(!registerAsBackend)}
          disabled={!enabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            registerAsBackend ? 'bg-primary' : 'bg-muted'
          } disabled:opacity-50`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
              registerAsBackend ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Configuration Fields */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Gateway URL
          </label>
          <input
            type="text"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            placeholder="http://gateway.example.com:3200"
            disabled={!enabled}
            className="w-full px-3 py-2 border border-border rounded-lg
                     bg-input text-foreground
                     placeholder:text-muted-foreground
                     focus:ring-2 focus:ring-primary focus:border-transparent
                     disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Gateway Secret
          </label>
          <input
            type="password"
            value={gatewaySecret}
            onChange={(e) => setGatewaySecret(e.target.value)}
            placeholder={config?.gatewaySecret ? '********' : 'Enter gateway secret'}
            disabled={!enabled}
            className="w-full px-3 py-2 border border-border rounded-lg
                     bg-input text-foreground
                     placeholder:text-muted-foreground
                     focus:ring-2 focus:ring-primary focus:border-transparent
                     disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Leave blank to keep existing secret
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Backend Name
          </label>
          <input
            type="text"
            value={backendName}
            onChange={(e) => setBackendName(e.target.value)}
            placeholder="My Mac"
            disabled={!enabled}
            className="w-full px-3 py-2 border border-border rounded-lg
                     bg-input text-foreground
                     placeholder:text-muted-foreground
                     focus:ring-2 focus:ring-primary focus:border-transparent
                     disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Optional display name for this backend
          </p>
        </div>

        {/* Proxy Settings */}
        <div className="pt-4 border-t border-border">
          <h4 className="text-sm font-semibold text-foreground mb-3">
            SOCKS5 Proxy (Optional)
          </h4>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Proxy URL
              </label>
              <input
                type="text"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                placeholder="socks5://127.0.0.1:1080"
                disabled={!enabled}
                data-testid="proxy-url-input"
                className="w-full px-3 py-2 border border-border rounded-lg
                         bg-input text-foreground
                         placeholder:text-muted-foreground
                         focus:ring-2 focus:ring-primary focus:border-transparent
                         disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground mt-1">
                SOCKS5 proxy for connecting to Gateway
              </p>
            </div>

            {proxyUrl.trim() && (
              <>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Proxy Username
                  </label>
                  <input
                    type="text"
                    value={proxyUsername}
                    onChange={(e) => setProxyUsername(e.target.value)}
                    placeholder="Optional"
                    disabled={!enabled}
                    data-testid="proxy-username-input"
                    className="w-full px-3 py-2 border border-border rounded-lg
                             bg-input text-foreground
                             placeholder:text-muted-foreground
                             focus:ring-2 focus:ring-primary focus:border-transparent
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Proxy Password
                  </label>
                  <input
                    type="password"
                    value={proxyPassword}
                    onChange={(e) => setProxyPassword(e.target.value)}
                    placeholder={config?.proxyPassword ? '********' : 'Optional'}
                    disabled={!enabled}
                    data-testid="proxy-password-input"
                    className="w-full px-3 py-2 border border-border rounded-lg
                             bg-input text-foreground
                             placeholder:text-muted-foreground
                             focus:ring-2 focus:ring-primary focus:border-transparent
                             disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave blank to keep existing password
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 pt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          data-testid="save-gateway-config"
          className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg
                   font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>

        {enabled && status?.connected && (
          <button
            onClick={handleDisconnect}
            disabled={saving}
            className="px-4 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg
                     font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Disconnect
          </button>
        )}

        {enabled && !status?.connected && (
          <button
            onClick={handleConnect}
            disabled={saving || !gatewayUrl || !config?.gatewaySecret}
            className="px-4 py-2 bg-success hover:bg-success/90 text-success-foreground rounded-lg
                     font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
