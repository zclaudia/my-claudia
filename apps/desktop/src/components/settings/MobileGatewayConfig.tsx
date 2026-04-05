import { useState } from 'react';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { isMobileGatewayConnected } from '../../services/mobileConnectionState';

export function MobileGatewayConfig() {
  const {
    directGatewayUrl,
    directGatewaySecret,
    setDirectGatewayConfig,
    clearDirectGatewayConfig,
  } = useGatewayStore();
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeConnectionError = useFacadeStore((s) => s.connectionError);
  const isGatewayConnected = isMobileGatewayConnected(facadeConnectionState);
  const displayStatus = isGatewayConnected ? 'connected' : facadeConnectionState;
  const displayError = facadeConnectionError;

  const [url, setUrl] = useState(directGatewayUrl || '');
  const [secret, setSecret] = useState(directGatewaySecret || '');
  const [dirty, setDirty] = useState(false);

  const handleSave = () => {
    const trimmedUrl = url.trim();
    const trimmedSecret = secret.trim();
    if (!trimmedUrl || !trimmedSecret) return;
    setDirectGatewayConfig(trimmedUrl, trimmedSecret);
    setDirty(false);
  };

  const handleDisconnect = () => {
    clearDirectGatewayConfig();
    setUrl('');
    setSecret('');
    setDirty(false);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure your gateway connection. Changes will reconnect automatically.
      </p>

      {/* Connection status */}
      <div className="p-3 bg-secondary/50 rounded-lg space-y-1">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isGatewayConnected ? 'bg-success' : 'bg-destructive'}`} />
          <span className="text-sm">
            {isGatewayConnected ? 'Gateway connected' : `Gateway ${displayStatus}`}
          </span>
        </div>
        {directGatewayUrl && (
          <p className="text-[10px] text-muted-foreground font-mono break-all">
            Config: {directGatewayUrl}
          </p>
        )}
        {displayError && (
          <p className="text-[10px] text-destructive break-all">
            Error: {displayError}
          </p>
        )}
      </div>

      {/* URL */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Gateway URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setDirty(true); }}
          placeholder="http://gateway.example.com:3200"
          className="w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
        />
      </div>

      {/* Secret */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Gateway Secret</label>
        <input
          type="password"
          value={secret}
          onChange={(e) => { setSecret(e.target.value); setDirty(true); }}
          placeholder="Enter gateway secret"
          className="w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:border-primary"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {dirty && (
          <button
            onClick={handleSave}
            disabled={!url.trim() || !secret.trim()}
            className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 shadow-apple-sm hover:bg-primary/90 transition-colors"
          >
            Save & Reconnect
          </button>
        )}
        {directGatewayUrl && (
          <button
            onClick={handleDisconnect}
            className="flex-1 py-2.5 border border-destructive text-destructive rounded-lg text-sm font-medium hover:bg-destructive/10"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
