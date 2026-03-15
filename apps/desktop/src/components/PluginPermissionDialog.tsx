/**
 * Plugin Permission Dialog
 *
 * Modal dialog that appears when a plugin requests permissions at runtime.
 * Displays the requested permissions with risk-level badges and allows
 * the user to grant or deny them.
 */

import { useState, useCallback } from 'react';
import { usePluginStore } from '../stores/pluginStore';
import { useConnection } from '../contexts/ConnectionContext';
import { useAndroidBack } from '../hooks/useAndroidBack';

// Permission risk levels (mirrors server PERMISSION_LEVELS)
const PERMISSION_LEVELS: Record<string, number> = {
  'session.read': 1,
  'project.read': 1,
  'storage': 1,
  'fs.read': 2,
  'network.fetch': 2,
  'timer': 2,
  'provider.call': 2,
  'fs.write': 3,
  'session.write': 3,
  'notification': 3,
  'clipboard.read': 3,
  'clipboard.write': 3,
  'shell.execute': 4,
};

const LEVEL_LABELS: Record<number, string> = {
  1: 'Safe',
  2: 'Medium',
  3: 'Sensitive',
  4: 'Dangerous',
};

const LEVEL_COLORS: Record<number, string> = {
  1: 'bg-green-500/15 text-green-400 border-green-500/30',
  2: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  3: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  4: 'bg-red-500/15 text-red-400 border-red-500/30',
};

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'session.read': 'Read session information',
  'project.read': 'Read project metadata',
  'storage': 'Persist data across sessions',
  'fs.read': 'Read files from disk',
  'network.fetch': 'Make network requests',
  'timer': 'Set timers and intervals',
  'provider.call': 'Call AI providers',
  'fs.write': 'Write files to disk',
  'session.write': 'Modify session data',
  'notification': 'Show notifications',
  'clipboard.read': 'Read clipboard contents',
  'clipboard.write': 'Write to clipboard',
  'shell.execute': 'Execute shell commands',
};

export function PluginPermissionDialog() {
  const { pendingPermissionRequest, setPendingPermissionRequest } = usePluginStore();
  const { sendMessage } = useConnection();
  const [remember, setRemember] = useState(false);

  const handleDecision = useCallback((granted: boolean) => {
    if (!pendingPermissionRequest) return;

    sendMessage({
      type: 'plugin_permission_response',
      pluginId: pendingPermissionRequest.pluginId,
      granted,
      permanently: remember,
    });

    setPendingPermissionRequest(null);
    setRemember(false);
  }, [pendingPermissionRequest, remember, sendMessage, setPendingPermissionRequest]);

  if (!pendingPermissionRequest) return null;

  // Sort permissions by risk level (dangerous first)
  const sortedPermissions = [...pendingPermissionRequest.permissions].sort(
    (a, b) => (PERMISSION_LEVELS[b] || 0) - (PERMISSION_LEVELS[a] || 0)
  );

  const maxLevel = Math.max(...sortedPermissions.map(p => PERMISSION_LEVELS[p] || 1));

  useAndroidBack(() => handleDecision(false), !!pendingPermissionRequest, 45);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md pointer-events-auto flex flex-col"
          style={{ maxHeight: '80vh' }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
            <div className={`p-1.5 rounded ${LEVEL_COLORS[maxLevel] || LEVEL_COLORS[1]}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Permission Request</h2>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{pendingPermissionRequest.pluginName}</span> requests the following permissions
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Permission list */}
            <div className="space-y-1.5">
              {sortedPermissions.map((perm) => {
                const level = PERMISSION_LEVELS[perm] || 1;
                return (
                  <div
                    key={perm}
                    className="flex items-center gap-2 p-2 rounded bg-secondary/50"
                  >
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${LEVEL_COLORS[level]}`}>
                      {LEVEL_LABELS[level]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono">{perm}</span>
                      {PERMISSION_DESCRIPTIONS[perm] && (
                        <p className="text-xs text-muted-foreground">{PERMISSION_DESCRIPTIONS[perm]}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Warning for dangerous permissions */}
            {maxLevel >= 4 && (
              <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                This plugin requests dangerous permissions. Only grant if you trust the source.
              </div>
            )}

            {/* Remember checkbox */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border"
              />
              <span className="text-sm text-muted-foreground">Remember this decision</span>
            </label>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            <button
              onClick={() => handleDecision(false)}
              className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
            >
              Deny
            </button>
            <button
              onClick={() => handleDecision(true)}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded"
            >
              Allow
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default PluginPermissionDialog;
