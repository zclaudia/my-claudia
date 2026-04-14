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
  const [config, setConfig] = useState<NotificationConfig>(DEFAULT_NOTIFICATION_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ ok: false, subscriptions: {} });
  const [packageId, setPackageId] = useState('com.myClaudia.desktop');

  useEffect(() => {
    api.getNotificationConfig()
      .then((c) => { setConfig(c); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAndroid()) return;

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
  }, []);

  const update = useCallback((patch: Partial<NotificationConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
    setDirty(true);
    setTestResult(null);
    setSaveResult(null);
  }, []);

  const updateEvent = useCallback((key: keyof NotificationConfig['events'], value: boolean) => {
    setConfig(prev => ({
      ...prev,
      events: { ...prev.events, [key]: value },
    }));
    setDirty(true);
    setTestResult(null);
    setSaveResult(null);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      await api.updateNotificationConfig(config);
      try {
        await api.syncLocalNotificationBridge(config);
        setBridgeStatus(await api.getLocalNotificationBridgeStatus());
        setSaveResult({ ok: true, message: 'Notification settings saved.' });
      } catch (err) {
        setSaveResult({
          ok: false,
          message: err instanceof Error
            ? `Gateway config saved, but local ntfy-bridge sync failed: ${err.message}`
            : 'Gateway config saved, but local ntfy-bridge sync failed.',
        });
      }
      setDirty(false);
    } catch (err) {
      console.error('[Notifications] Failed to save:', err);
      setSaveResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to save notification settings' });
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Save first so server uses latest config
      await api.updateNotificationConfig(config);
      await api.syncLocalNotificationBridge(config);
      setBridgeStatus(await api.getLocalNotificationBridgeStatus());
      setDirty(false);
      await api.sendTestNotification();
      setTestResult({ ok: true, message: 'Test notification sent! Check your ntfy app.' });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Failed to send' });
    } finally {
      setTesting(false);
    }
  }, [config]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (!isNotificationConfigAvailable()) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Push notifications require a gateway connection. Connect to a gateway to configure ntfy notifications.
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

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Receive push notifications on your phone via <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ntfy</a>. Install the ntfy app and subscribe to the same topic configured below.
      </p>

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
          onClick={() => !readOnly && update({ enabled: !config.enabled })}
          disabled={readOnly}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
            config.enabled ? 'bg-primary' : 'bg-muted'
          } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                  onChange={(e) => update({ ntfyUrl: e.target.value })}
                  placeholder="https://ntfy.sh"
                  readOnly={readOnly}
                  className={`w-full px-3 py-1.5 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Topic</label>
                <input
                  type="text"
                  value={config.ntfyTopic}
                  onChange={(e) => update({ ntfyTopic: e.target.value })}
                  placeholder="my-claudia-alerts"
                  readOnly={readOnly}
                  className={`w-full px-3 py-1.5 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Use a unique, hard-to-guess topic name for privacy.
                </p>
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
                    onClick={() => !readOnly && updateEvent(key, !config.events[key])}
                    disabled={readOnly}
                    className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${
                      config.events[key] ? 'bg-primary' : 'bg-muted'
                    } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
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
          {saveResult && (
            <div className={`p-3 rounded-lg text-sm ${
              saveResult.ok
                ? 'bg-success/10 border border-success/30 text-success'
                : 'bg-destructive/10 border border-destructive/30 text-destructive'
            }`}>
              {saveResult.message}
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

          {/* Action buttons */}
          {!readOnly && (
          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={testing || !config.ntfyTopic}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary disabled:opacity-50 font-medium transition-colors"
            >
              {testing ? 'Sending...' : 'Send Test'}
            </button>
            {dirty && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-medium shadow-apple-sm transition-colors"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>
          )}
        </>
      )}

      {/* Save when only toggling enabled/disabled */}
      {!readOnly && dirty && !config.enabled && (
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-medium shadow-apple-sm transition-colors"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
