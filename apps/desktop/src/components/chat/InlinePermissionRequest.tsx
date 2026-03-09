import { useState, useEffect, useRef } from 'react';
import { Check, X, Lock, AlertTriangle } from 'lucide-react';
import { usePermissionStore, type PermissionRequest } from '../../stores/permissionStore';
import { PermissionDetailView } from '../permission/PermissionDetailView';

interface InlinePermissionRequestProps {
  request: PermissionRequest;
  onDecision: (requestId: string, allow: boolean, remember?: boolean, credential?: string, feedback?: string) => void;
}

export function InlinePermissionRequest({ request, onDecision }: InlinePermissionRequestProps) {
  const [remainingTime, setRemainingTime] = useState(0);
  const [remember, setRemember] = useState(false);
  const [credential, setCredential] = useState('');
  const [resolved, setResolved] = useState<'allow' | 'deny' | null>(null);
  const [countdownStopped, setCountdownStopped] = useState(false);
  const credentialInputRef = useRef<HTMLInputElement>(null);
  const onDecisionRef = useRef(onDecision);
  const feedback = usePermissionStore((state) => state.feedbackDrafts[request.requestId] || '');
  const setFeedbackDraft = usePermissionStore((state) => state.setFeedbackDraft);
  const clearFeedbackDraft = usePermissionStore((state) => state.clearFeedbackDraft);
  const isExitPlanModeRequest = request.toolName.toLowerCase().includes('exitplanmode');

  useEffect(() => {
    onDecisionRef.current = onDecision;
  }, [onDecision]);

  useEffect(() => {
    setRemember(false);
    setCredential('');
    setCountdownStopped(false);
    setResolved(null);

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
  }, [request.requestId]);

  useEffect(() => {
    if (request.timeoutSec === 0) {
      setRemainingTime(0);
      return;
    }

    const interval = setInterval(() => {
      setRemainingTime((prev) => {
        if (countdownStopped) return prev;
        if (prev <= 1) {
          // Backend handles auto-approve; for auto-deny, also trigger from frontend as fallback
          if (!request.aiInitiated) {
            setResolved('deny');
            clearFeedbackDraft(request.requestId);
            onDecisionRef.current(request.requestId, false);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [request.requestId, request.timeoutSec, request.aiInitiated, countdownStopped, clearFeedbackDraft]);

  const handleAllow = () => {
    setResolved('allow');
    clearFeedbackDraft(request.requestId);
    if (request.requiresCredential) {
      onDecision(request.requestId, true, remember, credential || undefined);
    } else {
      onDecision(request.requestId, true, remember);
    }
  };

  const handleDeny = () => {
    setResolved('deny');
    clearFeedbackDraft(request.requestId);
    onDecision(request.requestId, false, remember);
  };

  const handleDenyWithFeedback = () => {
    const note = feedback.trim();
    if (!note) return;
    setCountdownStopped(true);
    setResolved('deny');
    clearFeedbackDraft(request.requestId);
    onDecision(request.requestId, false, remember, undefined, note);
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
          <Check size={14} strokeWidth={2} className="flex-shrink-0" />
        ) : (
          <X size={14} strokeWidth={2} className="flex-shrink-0" />
        )}
        <span className="font-mono">{request.toolName}</span>
        <span>— {resolved === 'allow' ? 'Approved' : 'Denied'}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-border overflow-hidden border-l-4 ${borderColor}`}>
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
          <Lock size={16} strokeWidth={2} className="text-amber-500 flex-shrink-0" />
        ) : (
          <AlertTriangle size={16} strokeWidth={2} className="text-warning flex-shrink-0" />
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
        {isExitPlanModeRequest && (
          <div className="mt-2">
            <label className="text-[11px] text-muted-foreground block mb-1">
              Comment (sent with deny)
            </label>
            <textarea
              value={feedback}
              onChange={(e) => setFeedbackDraft(request.requestId, e.target.value)}
              placeholder="Why do you reject exiting plan mode?"
              rows={2}
              className="w-full px-2.5 py-1.5 bg-input border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            />
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
            className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-secondary-foreground rounded-full text-xs font-medium transition-colors"
          >
            Deny
          </button>
          {isExitPlanModeRequest && (
            <button
              onClick={handleDenyWithFeedback}
              disabled={!feedback.trim()}
              className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-secondary-foreground rounded-full text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Deny + Comment
            </button>
          )}
          <button
            onClick={handleAllow}
            disabled={isCredential && !credential}
            className="px-3 py-1.5 bg-success hover:bg-success/80 active:bg-success/70 text-success-foreground rounded-full text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
