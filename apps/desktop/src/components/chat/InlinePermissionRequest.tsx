import { useState, useEffect, useRef } from 'react';
import type { PermissionRequest } from '../../stores/permissionStore';
import { PermissionDetailView } from '../permission/PermissionDetailView';

interface InlinePermissionRequestProps {
  request: PermissionRequest;
  onDecision: (requestId: string, allow: boolean, remember?: boolean, credential?: string) => void;
}

export function InlinePermissionRequest({ request, onDecision }: InlinePermissionRequestProps) {
  const [remainingTime, setRemainingTime] = useState(0);
  const [remember, setRemember] = useState(false);
  const [credential, setCredential] = useState('');
  const [resolved, setResolved] = useState<'allow' | 'deny' | null>(null);
  const credentialInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRemember(false);
    setCredential('');

    if (request.timeoutSec === 0) {
      setRemainingTime(0);
      if (request.requiresCredential) {
        setTimeout(() => credentialInputRef.current?.focus(), 100);
      }
      return;
    }

    setRemainingTime(request.timeoutSec);

    if (request.requiresCredential) {
      setTimeout(() => credentialInputRef.current?.focus(), 100);
    }

    const interval = setInterval(() => {
      setRemainingTime((prev) => {
        if (prev <= 1) {
          // Backend handles auto-approve; for auto-deny, also trigger from frontend as fallback
          if (!request.aiInitiated) {
            setResolved('deny');
            onDecision(request.requestId, false);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [request.requestId, request.timeoutSec, request.requiresCredential, onDecision]);

  const handleAllow = () => {
    setResolved('allow');
    if (request.requiresCredential) {
      onDecision(request.requestId, true, remember, credential || undefined);
    } else {
      onDecision(request.requestId, true, remember);
    }
  };

  const handleDeny = () => {
    setResolved('deny');
    onDecision(request.requestId, false, remember);
  };

  const hasTimeout = request.timeoutSec > 0;
  const progressPercent = hasTimeout ? (remainingTime / request.timeoutSec) * 100 : 0;
  const credentialLabel = request.credentialHint === 'sudo_password' ? 'sudo password' : 'credential';
  const isCredential = request.requiresCredential;
  const borderColor = isCredential ? 'border-l-amber-500' : 'border-l-warning';

  // Resolved compact state
  if (resolved) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-xs ${
        resolved === 'allow' ? 'text-success' : 'text-muted-foreground'
      }`}>
        {resolved === 'allow' ? (
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span className="font-mono">{request.toolName}</span>
        <span>— {resolved === 'allow' ? 'Approved' : 'Denied'}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-border overflow-hidden border-l-4 ${borderColor}`}>
      {/* Timeout progress bar */}
      {hasTimeout && (
        <div className="h-0.5 bg-muted">
          <div
            className={`h-full transition-all duration-1000 ease-linear ${request.aiInitiated ? 'bg-success' : 'bg-warning'}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Header */}
      <div className="px-3 py-2 bg-card flex items-center gap-2">
        {isCredential ? (
          <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-warning flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        )}
        <span className="text-sm font-medium text-card-foreground">
          {isCredential ? 'Credential Required' : 'Permission Required'}
        </span>
        <span className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono text-foreground">
          {request.toolName}
        </span>
        {request.backendName && (
          <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            {request.backendName}
          </span>
        )}
      </div>

      {/* Detail */}
      <div className="px-3 py-2 border-t border-border/50">
        <PermissionDetailView
          toolName={request.toolName}
          detail={request.detail}
          maxHeightClass="max-h-32"
        />

        {/* Credential input */}
        {isCredential && (
          <div className="mt-2">
            <input
              ref={credentialInputRef}
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && credential) handleAllow();
              }}
              placeholder={`Enter ${credentialLabel}`}
              autoComplete="off"
              className="w-full px-2.5 py-1.5 bg-input border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Encrypted end-to-end
            </p>
          </div>
        )}

        {/* Timer + remember + actions */}
        <div className="flex items-center gap-2 mt-2">
          {/* Timer */}
          {hasTimeout ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              {request.aiInitiated && <span>Auto-approve:</span>}
              <span className={
                request.aiInitiated
                  ? (remainingTime <= 10 ? 'text-success font-semibold' : 'text-success/80')
                  : (remainingTime <= 10 ? 'text-destructive font-semibold' : 'text-warning')
              }>
                {remainingTime}s
              </span>
            </span>
          ) : null}

          {/* Remember checkbox */}
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-input bg-background text-primary focus:ring-primary"
            />
            Remember
          </label>

          <div className="flex-1" />

          {/* Action buttons */}
          <button
            onClick={handleDeny}
            className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-secondary-foreground rounded text-xs font-medium transition-colors"
          >
            Deny
          </button>
          <button
            onClick={handleAllow}
            disabled={isCredential && !credential}
            className="px-3 py-1.5 bg-success hover:bg-success/80 active:bg-success/70 text-success-foreground rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
