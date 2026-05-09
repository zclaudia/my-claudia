import { useState, useEffect, useCallback } from 'react';
import * as api from '../../services/api';
import type { NotificationConfig } from '@my-claudia/shared';
import { DEFAULT_NOTIFICATION_CONFIG } from '@my-claudia/shared';
import { isNotificationConfigAvailable } from '../../services/api/notifications';
import { isAndroid } from '../../utils/platform';

type BridgeStatus = Awaited<ReturnType<typeof api.getLocalNotificationBridgeStatus>>;

const EVENT_LABELS: { key: keyof NotificationConfig['events']; label: string; description: string }[] = [
  { key: 'permissionRequest', label: 'Permission requests', description: 'Tool execution needs your approval' },
  { key: 'promptRequest', label: 'Prompt requests', description: 'The app surfaces a prompt request' },
  { key: 'runCompleted', label: 'Run completed', description: 'A run finishes successfully' },
  { key: 'runFailed', label: 'Run failed', description: 'A run fails with an error' },
  { key: 'backgroundPermission', label: 'Background task alerts', description: 'Background task needs your attention' },
  { key: 'processLeak', label: 'Process leak alerts', description: 'Orphaned child processes were detected' },
];

export function NotificationSettingsInline({ readOnly = false }: { readOnly?: boolean }) {
  const android = isAndroid();
  const [config, setConfig] = useState<NotificationConfig>(DEFAULT_NOTIFICATION_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [syncingBridge, setSyncingBridge] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [statusResult, setStatusResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ ok: false, subscriptions: {} });
  const [packageId, setPackageId] = useState('com.myClaudia.mobile');

  useEffect(() => {
    api.getNotificationConfig()
      .then((c) => {
        setConfig(c);
        setConfigLoaded(true);
        setConfigError(null);
        setLoading(false);
      })
      .catch((err) => {
        setConfigLoaded(false);
        setConfigError(err instanceof Error ? err.message : 'Failed to load gateway notification policy.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!android) return;

    import('@tauri-apps/api/app')
      .then(({ getIdentifier }) => getIdentifier())
      .then(setPackageId)
      .catch(() => {});

    let cancelled = false;
    const loadStatus = async () => {
      const next = await api.getLocalNotificationBridgeStatus();
      if (!cancelled) {
        setBridgeStatus(next);
      }
    };

    void loadStatus();
    const timer = window.setInterval(() => {
      void loadStatus();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [android]);

  useEffect(() => {
    if (!android || loading || !configLoaded || configError) return;

    let cancelled = false;
    const syncRegistration = async () => {
      try {
        await api.syncLocalNotificationBridge(config);
      } catch {
        // Surface bridge failures via status polling instead of blocking the page.
      }

      try {
        const next = await api.getLocalNotificationBridgeStatus();
        if (!cancelled) {
          setBridgeStatus(next);
        }
      } catch {
        if (!cancelled) {
          setBridgeStatus({ ok: false, subscriptions: {} });
        }
      }
    };

    void syncRegistration();

    return () => {
      cancelled = true;
    };
  }, [android, loading, config, configLoaded, configError]);

  const handleResyncDevice = useCallback(async () => {
    setSyncingBridge(true);
    setStatusResult(null);
    try {
      const refreshed = await api.refreshNotificationConfig();
      if (!refreshed) {
        throw new Error('No gateway connection — notification config is not available');
      }
      setConfig(refreshed);
      setConfigLoaded(true);
      setConfigError(null);
      setBridgeStatus(await api.getLocalNotificationBridgeStatus());
      setStatusResult({ ok: true, message: 'This device is synced to the gateway notification policy.' });
    } catch (err) {
      setStatusResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to sync this device to the local bridge.',
      });
    } finally {
      setSyncingBridge(false);
    }
  }, []);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const refreshed = await api.refreshNotificationConfig();
      if (!refreshed) {
        throw new Error('No gateway connection — notification config is not available');
      }
      setConfig(refreshed);
      setConfigLoaded(true);
      setConfigError(null);
      setBridgeStatus(await api.getLocalNotificationBridgeStatus());
      await api.sendTestNotification();
      setTestResult({ ok: true, message: 'Test notification sent. Check this device for delivery.' });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to send' });
    } finally {
      setTesting(false);
    }
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (!isNotificationConfigAvailable()) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Push notifications require a gateway connection. Connect to a gateway to view the active ntfy notification policy.
        </p>
      </div>
    );
  }

  const localSubscription = bridgeStatus.subscriptions?.[packageId] as {
    connected?: boolean;
    status?: string;
    last_error?: string;
    retry_in_ms?: number;
  } | undefined;
  const gatewayPolicyAvailable = configLoaded && !configError;

  const bridgeStatusText = !isAndroid()
    ? 'Local ntfy-bridge applies on Android only.'
    : !bridgeStatus.ok
      ? 'Local ntfy-bridge unavailable.'
      : localSubscription?.connected
        ? 'Local ntfy-bridge connected.'
        : localSubscription?.status === 'backoff'
          ? `Local ntfy-bridge reconnecting${typeof localSubscription.retry_in_ms === 'number' ? ` in ${Math.ceil(localSubscription.retry_in_ms / 1000)}s` : ''}.`
          : localSubscription?.status === 'connecting'
            ? 'Local ntfy-bridge connecting.'
            : 'Local ntfy-bridge idle.';

  if (android) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          This device consumes notification policy from the gateway. Event rules are configured statically on the gateway; Android only handles local delivery and status.
        </p>

        <div className="p-3 bg-secondary/40 rounded-lg border border-border/60 space-y-1">
          <p className="text-sm font-medium">This device</p>
          <p className="text-xs text-muted-foreground">{bridgeStatusText}</p>
          <p className="text-xs text-muted-foreground">Package: {packageId}</p>
          {localSubscription?.last_error && (
            <p className="text-xs text-destructive">Last error: {localSubscription.last_error}</p>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Gateway policy</h3>
          <div className="space-y-3 p-3 bg-secondary/50 rounded-lg border border-border/60">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="text-sm font-medium">
                {gatewayPolicyAvailable ? (config.enabled ? 'Enabled' : 'Disabled') : 'Unavailable'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Server URL</p>
              <p className="text-sm break-all">{gatewayPolicyAvailable ? (config.ntfyUrl || 'Not configured') : 'Unavailable'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Topic</p>
              <p className="text-sm break-all">{gatewayPolicyAvailable ? (config.ntfyTopic || 'Not configured') : 'Unavailable'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Auth</p>
              <p className="text-sm font-medium">{gatewayPolicyAvailable ? (config.ntfyAuthMode || 'none') : 'Unavailable'}</p>
            </div>
            {configError && (
              <p className="text-xs text-destructive">{configError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Event types, enablement, and delivery policy are configured on the gateway, not on this device.
            </p>
          </div>
        </div>

        {statusResult && (
          <div className={`p-3 rounded-lg text-sm ${
            statusResult.ok
              ? 'bg-success/10 border border-success/30 text-success'
              : 'bg-destructive/10 border border-destructive/30 text-destructive'
          }`}>
            {statusResult.message}
          </div>
        )}

        {testResult && (
          <div className={`p-3 rounded-lg text-sm ${
            testResult.ok
              ? 'bg-success/10 border border-success/30 text-success'
              : 'bg-destructive/10 border border-destructive/30 text-destructive'
          }`}>
            {testResult.message}
          </div>
        )}

        {!readOnly && (
          <div className="flex gap-2">
            <button
              onClick={handleResyncDevice}
              disabled={syncingBridge}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary disabled:opacity-50 font-medium transition-colors"
            >
              {syncingBridge ? 'Syncing...' : 'Sync Device'}
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-medium shadow-apple-sm transition-colors"
            >
              {testing ? 'Sending...' : 'Send Test'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Receive push notifications on your phone via <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ntfy</a>. Install the ntfy app and subscribe to the same topic configured below.
      </p>

      <div className="p-3 bg-secondary/40 rounded-lg border border-border/60">
        <p className="text-sm font-medium">Gateway policy</p>
        <p className="text-xs text-muted-foreground mt-1">
          Notification settings are configured statically on the gateway and are read-only here.
        </p>
      </div>

      <div className="p-3 bg-secondary/40 rounded-lg border border-border/60 space-y-1">
        <p className="text-sm font-medium">Local bridge</p>
        <p className="text-xs text-muted-foreground">{bridgeStatusText}</p>
        {isAndroid() && localSubscription?.last_error && (
          <p className="text-xs text-destructive">Last error: {localSubscription.last_error}</p>
        )}
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
        <div>
          <p className="text-sm font-medium">Enable notifications</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send push notifications for events
          </p>
        </div>
        <button
          disabled={true}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
            config.enabled ? 'bg-primary' : 'bg-muted'
          } opacity-60 cursor-not-allowed`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              config.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {config.enabled && (
        <>
          {/* ntfy server + topic */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">ntfy Configuration</h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Server URL</label>
                <input
                  type="text"
                  value={config.ntfyUrl}
                  placeholder="https://ntfy.sh"
                  readOnly={true}
                  className="w-full px-3 py-1.5 bg-secondary border border-border rounded-md text-sm opacity-60 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Topic</label>
                <input
                  type="text"
                  value={config.ntfyTopic}
                  placeholder="my-claudia-alerts"
                  readOnly={true}
                  className="w-full px-3 py-1.5 bg-secondary border border-border rounded-md text-sm opacity-60 cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Use a unique, hard-to-guess topic name for privacy.
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Auth Mode</label>
                <input
                  type="text"
                  value={config.ntfyAuthMode}
                  readOnly={true}
                  className="w-full px-3 py-1.5 bg-secondary border border-border rounded-md text-sm opacity-60 cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          {/* Event toggles */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Notify me when</h3>
            <div className="space-y-1">
              {EVENT_LABELS.map(({ key, label, description }) => (
                <div key={key} className="flex items-center justify-between p-2 rounded-lg hover:bg-secondary/30">
                  <div>
                    <p className="text-sm">{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                  <button
                    disabled={true}
                    className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${
                      config.events[key] ? 'bg-primary' : 'bg-muted'
                    } opacity-60 cursor-not-allowed`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
                        config.events[key] ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`p-3 rounded-lg text-sm ${
              testResult.ok
                ? 'bg-success/10 border border-success/30 text-success'
                : 'bg-destructive/10 border border-destructive/30 text-destructive'
            }`}>
              {testResult.message}
            </div>
          )}

          {/* Action buttons */}
          {statusResult && (
            <div className={`p-3 rounded-lg text-sm ${
              statusResult.ok
                ? 'bg-success/10 border border-success/30 text-success'
                : 'bg-destructive/10 border border-destructive/30 text-destructive'
            }`}>
              {statusResult.message}
            </div>
          )}

          {!readOnly && (
          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={testing || !config.ntfyTopic}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary disabled:opacity-50 font-medium transition-colors"
            >
              {testing ? 'Sending...' : 'Send Test'}
            </button>
          </div>
          )}
        </>
      )}
    </div>
  );
}
