import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useConnection } from '../../contexts/ConnectionContext';
import { useUIStore, type FontSizePreset } from '../../stores/uiStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { isMacOS } from '../../utils/platform';
import { ThemeToggle } from './ThemeToggle';
import type { SdkVersionReport } from '@my-claudia/shared';
import * as api from '../../services/api';
import { Select } from '../../components/ui/Select';

interface GeneralSettingsProps {
  isOpen: boolean;
  activeServerExists: boolean;
  embeddedServerPort: number | null;
}

export function GeneralSettings({ isOpen, activeServerExists, embeddedServerPort }: GeneralSettingsProps) {
  const { embeddedServerStatus, embeddedServerError, restartEmbeddedServer } = useConnection();
  const isMobile = useIsMobile();

  // SDK version check
  const [sdkVersions, setSdkVersions] = useState<SdkVersionReport | null>(null);
  useEffect(() => {
    if (!isOpen || !activeServerExists || !embeddedServerPort) return;
    const address = `localhost:${embeddedServerPort}`;
    api.getServerInfo(address)
      .then(info => setSdkVersions(info.sdkVersions ?? null))
      .catch(() => setSdkVersions(null));
  }, [isOpen, activeServerExists, embeddedServerPort]);

  // macOS permission checks
  const [fdaGranted, setFdaGranted] = useState<boolean | null>(null);
  const [folderPerms, setFolderPerms] = useState<{ name: string; granted: boolean }[]>([]);
  useEffect(() => {
    if (!isMacOS() || !isOpen) return;
    invoke<boolean>('check_full_disk_access').then(setFdaGranted).catch(() => setFdaGranted(null));
    invoke<{ name: string; granted: boolean }[]>('check_folder_permissions').then(setFolderPerms).catch(() => {});
  }, [isOpen]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Appearance</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span className="text-sm">Theme</span>
            </div>
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h8m-8 6h16" />
              </svg>
              <span className="text-sm">Font Size</span>
            </div>
            <FontSizeToggle />
          </div>
          {!isMobile && <NotchPanelToggle />}
          {!isMobile && <NotchMonitorSelector />}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Local Server</h3>
        <div className="space-y-3">
          <div className="p-3 bg-secondary/50 rounded-lg space-y-3">
            <div>
              <div className="text-sm">Embedded server runtime</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                AI review now relies on local deterministic redaction rules before sending content to the remote reviewer.
              </div>
            </div>

            <div className="p-3 bg-background/70 rounded-lg space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Runtime status</span>
                <span className={
                  embeddedServerStatus === 'ready'
                    ? 'text-success'
                    : embeddedServerStatus === 'error'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }>
                  {embeddedServerStatus}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Port</span>
                <span>{embeddedServerPort ?? '-'}</span>
              </div>
              {embeddedServerError && (
                <div className="text-xs text-destructive break-all">
                  {embeddedServerError}
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              Changes to AI review and permission behavior apply on the next embedded server start.
            </div>

            {embeddedServerStatus !== 'disabled' && (
              <div className="flex justify-end">
                <button
                  onClick={() => { void restartEmbeddedServer(); }}
                  className="px-3 py-1 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
                >
                  Restart Embedded Server
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {isMacOS() && fdaGranted !== null && (
        <div>
          <h3 className="text-sm font-medium mb-3">Permissions</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <div>
                  <span className="text-sm">Full Disk Access</span>
                  {!fdaGranted && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Required for terminal to access all directories
                    </p>
                  )}
                </div>
              </div>
              {fdaGranted ? (
                <span className="text-sm text-success">Granted</span>
              ) : (
                <button
                  onClick={() => invoke('open_full_disk_access_settings')}
                  className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium transition-colors"
                >
                  Open Settings
                </button>
              )}
            </div>
            {folderPerms.length > 0 && folderPerms.some(f => !f.granted) && (
              <div className="p-3 bg-secondary/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm">Folder Access</span>
                  <button
                    onClick={() => invoke('open_files_and_folders_settings')}
                    className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium transition-colors"
                  >
                    Open Settings
                  </button>
                </div>
                <div className="space-y-1">
                  {folderPerms.map(f => (
                    <div key={f.name} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">~/{f.name}</span>
                      {f.granted ? (
                        <span className="text-success">Granted</span>
                      ) : (
                        <span className="text-destructive">Denied</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium mb-3">About</h3>
        <div className="p-3 bg-secondary/50 rounded-lg space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Version</span>
            <span>{__APP_VERSION__}</span>
          </div>
          {sdkVersions && sdkVersions.sdks.length > 0 && (
            <>
              <div className="border-t border-border/50 my-1.5" />
              {sdkVersions.sdks.map(sdk => (
                <div key={sdk.name} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{sdk.name}</span>
                  <span className={sdk.outdated ? 'text-amber-500' : 'text-muted-foreground'}>
                    {sdk.current}{sdk.outdated ? ` → ${sdk.latest}` : ''}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Small inline components ---

const FONT_SIZE_OPTIONS: { key: FontSizePreset; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];

function FontSizeToggle() {
  const { fontSize, setFontSize } = useUIStore();
  return (
    <div className="flex items-center bg-secondary/80 rounded-lg p-0.5 gap-0.5">
      {FONT_SIZE_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => setFontSize(opt.key)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
            fontSize === opt.key
              ? 'bg-card text-foreground shadow-apple-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NotchPanelToggle() {
  const { showNotchPanel, setShowNotchPanel } = useUIStore();
  return (
    <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <div>
          <span className="text-sm">Notification Panel</span>
          <p className="text-xs text-muted-foreground">Show Dynamic Island-style notifications at top of screen</p>
        </div>
      </div>
      <button
        onClick={() => setShowNotchPanel(!showNotchPanel)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          showNotchPanel ? 'bg-primary' : 'bg-secondary'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
            showNotchPanel ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </div>
  );
}

interface MonitorInfo {
  name: string | null;
  width: number;
  height: number;
  scale_factor: number;
}

function NotchMonitorSelector() {
  const { showNotchPanel, notchMonitor, setNotchMonitor } = useUIStore();
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  useEffect(() => {
    if (!showNotchPanel) return;
    invoke<MonitorInfo[]>('list_monitors')
      .then(setMonitors)
      .catch(() => setMonitors([]));
  }, [showNotchPanel]);

  if (!showNotchPanel || monitors.length <= 1) return null;

  return (
    <div className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span className="text-sm">Notification Display</span>
      </div>
      <Select
        value={notchMonitor === null ? '' : String(notchMonitor)}
        onChange={(next) => setNotchMonitor(next === '' ? null : parseInt(next, 10))}
        size="md"
        align="right"
        triggerClassName="min-w-[160px]"
        options={[
          { value: '', label: 'Primary' },
          ...monitors.map((m, i) => ({
            value: String(i),
            label: `${m.name || `Monitor ${i + 1}`} (${m.width}x${m.height})`,
          })),
        ]}
      />
    </div>
  );
}
