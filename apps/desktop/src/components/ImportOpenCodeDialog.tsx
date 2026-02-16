import { useState, useEffect, useMemo } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';
import * as api from '../services/api';

interface ImportOpenCodeDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

enum ImportStep {
  DETECT_DB = 1,
  PREVIEW_SESSIONS = 2,
  CONFIGURE = 3,
  PROGRESS = 4,
  COMPLETE = 5
}

interface ScanResult {
  projects: Array<{
    path: string;
    workspacePath?: string;
    sessions: Array<{
      id: string;
      summary: string;
      messageCount: number;
      timestamp: number;
    }>;
  }>;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ sessionId: string; error: string }>;
}

const CREATE_PROJECT_VALUE = '__create__';

function getDefaultPath(): string {
  // Best guess for display purposes; server handles actual detection
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) {
    return '~/Library/Application Support/opencode/opencode.db';
  }
  return '~/.local/share/opencode/opencode.db';
}

function getDirectoryName(wsPath: string): string {
  const parts = wsPath.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || wsPath;
}

export function ImportOpenCodeDialog({ isOpen, onClose }: ImportOpenCodeDialogProps) {
  const [step, setStep] = useState(ImportStep.DETECT_DB);
  const [opencodePath, setOpencodePath] = useState(getDefaultPath());
  const [scannedData, setScannedData] = useState<ScanResult | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [projectMapping, setProjectMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibleProjectsCount, setVisibleProjectsCount] = useState(10);

  const server = useServerStore((state) => state.getDefaultServer());
  const allProjects = useProjectStore((state) => state.projects) || [];
  const projects = allProjects.filter(p => !p.isInternal);

  // Auto-match source projects to target projects by workspacePath
  useEffect(() => {
    if (!scannedData?.projects) return;

    const newMapping: Record<string, string> = {};

    for (const srcProject of scannedData.projects) {
      const wp = srcProject.workspacePath;
      if (!wp) continue;

      const matches = projects.filter(p => p.rootPath === wp);

      if (matches.length === 1) {
        newMapping[srcProject.path] = matches[0].id;
      } else if (matches.length === 0) {
        newMapping[srcProject.path] = CREATE_PROJECT_VALUE;
      }
      // multiple matches → leave empty for manual selection
    }

    setProjectMapping(prev => {
      const merged = { ...prev };
      for (const [key, value] of Object.entries(newMapping)) {
        if (!merged[key]) {
          merged[key] = value;
        }
      }
      return merged;
    });
  }, [scannedData, projects]);

  // Source projects that have selected sessions
  const activeSourceProjects = useMemo(() => {
    if (!scannedData?.projects) return [];
    return scannedData.projects.filter(p =>
      p.sessions?.some(s => selectedSessions.has(s.id))
    );
  }, [scannedData, selectedSessions]);

  // Check if all active source projects have a mapping
  const allMapped = useMemo(() => {
    return activeSourceProjects.length > 0 &&
      activeSourceProjects.every(p => projectMapping[p.path]);
  }, [activeSourceProjects, projectMapping]);

  const getServerUrl = (): string => {
    const address = server?.address || 'localhost:3100';
    if (address.startsWith('http://') || address.startsWith('https://')) {
      return address;
    }
    return `http://${address}`;
  };

  const visibleProjects = useMemo(() => {
    if (!scannedData?.projects) return [];
    return scannedData.projects.slice(0, visibleProjectsCount);
  }, [scannedData, visibleProjectsCount]);

  const hasMoreProjects = useMemo(() => {
    return (scannedData?.projects?.length || 0) > visibleProjectsCount;
  }, [scannedData, visibleProjectsCount]);

  const handleClose = () => {
    setStep(ImportStep.DETECT_DB);
    setOpencodePath(getDefaultPath());
    setScannedData(null);
    setSelectedSessions(new Set());
    setProjectMapping({});
    setImportResult(null);
    setError(null);
    setLoading(false);
    setVisibleProjectsCount(10);
    onClose();
  };

  const scanDatabase = async (dbPath: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${getServerUrl()}/api/import/opencode/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opencodePath: dbPath })
      });

      const result = await response.json();

      if (result.success) {
        setScannedData(result.data);
        setVisibleProjectsCount(10);
        setTimeout(() => {
          setStep(ImportStep.PREVIEW_SESSIONS);
        }, 100);
      } else {
        setError(result.error?.message || 'Failed to scan OpenCode database');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan OpenCode database');
    } finally {
      setLoading(false);
    }
  };

  const handleScan = async () => {
    if (!opencodePath) {
      setError('Please enter the database path');
      return;
    }
    await scanDatabase(opencodePath);
  };

  const startImport = async () => {
    if (!scannedData || selectedSessions.size === 0 || !allMapped) {
      setError('Please configure target projects for all source directories');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setStep(ImportStep.PROGRESS);

      // Create projects for entries marked as __create__
      const resolvedMapping = { ...projectMapping };
      for (const srcProject of activeSourceProjects) {
        if (resolvedMapping[srcProject.path] === CREATE_PROJECT_VALUE) {
          const wp = srcProject.workspacePath || srcProject.path;
          const name = getDirectoryName(wp);
          const created = await api.createProject({
            name,
            rootPath: srcProject.workspacePath || undefined
          });
          resolvedMapping[srcProject.path] = created.id;
        }
      }

      // Build imports array with per-project mapping
      const imports = Array.from(selectedSessions).map(sessionId => {
        const srcProject = scannedData.projects.find(p =>
          p.sessions?.some(s => s.id === sessionId)
        );
        return {
          sessionId,
          targetProjectId: resolvedMapping[srcProject?.path || ''] || ''
        };
      });

      const response = await fetch(`${getServerUrl()}/api/import/opencode/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opencodePath,
          imports,
          options: { conflictStrategy: 'skip' }
        })
      });

      const result = await response.json();

      if (result.success) {
        setImportResult(result.data);
        setStep(ImportStep.COMPLETE);

        try {
          const [sessions, refreshedProjects] = await Promise.all([
            api.getSessions(),
            api.getProjects()
          ]);
          useProjectStore.getState().setSessions(sessions);
          useProjectStore.getState().setProjects(refreshedProjects);
        } catch (refreshErr) {
          console.error('[ImportOpenCodeDialog] Failed to refresh data:', refreshErr);
        }
      } else {
        setError(result.error?.message || 'Import failed');
        setStep(ImportStep.CONFIGURE);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep(ImportStep.CONFIGURE);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 z-50" onClick={handleClose} />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-h-[80vh] bg-card rounded-lg shadow-2xl z-50 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-xl font-semibold">Import from OpenCode</h2>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Step 1: Detect Database */}
          {step === ImportStep.DETECT_DB && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter the path to the OpenCode SQLite database file. The default location is detected automatically.
              </p>

              <div>
                <label className="block text-sm font-medium mb-2">
                  OpenCode Database Path
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={opencodePath}
                    onChange={(e) => setOpencodePath(e.target.value)}
                    placeholder={getDefaultPath()}
                    className="flex-1 px-3 py-2 bg-input border border-border rounded text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                  />
                  <button
                    onClick={handleScan}
                    disabled={loading}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {loading ? 'Scanning...' : 'Scan'}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  The database file is typically located at {getDefaultPath()}
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Preview Sessions */}
          {step === ImportStep.PREVIEW_SESSIONS && scannedData && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Select the sessions you want to import. Found {scannedData.projects?.reduce((sum, p) => sum + (p.sessions?.length || 0), 0) || 0} sessions across {scannedData.projects?.length || 0} projects.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const allSessionIds = new Set<string>();
                      (scannedData.projects || []).forEach(project => {
                        (project.sessions || []).forEach(session => {
                          if (session && session.id) {
                            allSessionIds.add(session.id);
                          }
                        });
                      });
                      setSelectedSessions(allSessionIds);
                    }}
                    className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSelectedSessions(new Set())}
                    className="px-3 py-1 text-xs bg-secondary text-secondary-foreground rounded hover:opacity-90"
                  >
                    Clear All
                  </button>
                </div>
              </div>

              {visibleProjects.map(project => (
                <div key={project.path} className="border border-border rounded-lg p-4">
                  <h3 className="font-medium mb-3 text-sm">{project.workspacePath || project.path || 'Unknown path'}</h3>

                  <div className="space-y-2">
                    {(project.sessions || []).map(session => (
                      <label key={session.id} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedSessions.has(session.id)}
                          onChange={(e) => {
                            const newSelected = new Set(selectedSessions);
                            if (e.target.checked) {
                              newSelected.add(session.id);
                            } else {
                              newSelected.delete(session.id);
                            }
                            setSelectedSessions(newSelected);
                          }}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium">{session.summary}</div>
                          <div className="text-xs text-muted-foreground">
                            {session.messageCount} messages • {new Date(session.timestamp).toLocaleDateString()}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {/* Load more button for pagination */}
              {hasMoreProjects && (
                <button
                  onClick={() => setVisibleProjectsCount(prev => prev + 10)}
                  className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded hover:opacity-90 text-sm"
                >
                  Load {Math.min(10, (scannedData.projects?.length || 0) - visibleProjectsCount)} more projects...
                </button>
              )}

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => setStep(ImportStep.DETECT_DB)}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:opacity-90"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(ImportStep.CONFIGURE)}
                  disabled={selectedSessions.size === 0}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                >
                  Next ({selectedSessions.size} selected)
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Configure */}
          {step === ImportStep.CONFIGURE && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Configure target projects for {selectedSessions.size} session(s).
              </p>

              <div className="space-y-4">
                {activeSourceProjects.map(srcProject => {
                  const selectedCount = srcProject.sessions?.filter(s => selectedSessions.has(s.id)).length || 0;
                  const currentValue = projectMapping[srcProject.path] || '';
                  const wp = srcProject.workspacePath;
                  const dirName = wp ? getDirectoryName(wp) : getDirectoryName(srcProject.path);

                  return (
                    <div key={srcProject.path} className="border border-border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium truncate" title={wp || srcProject.path}>
                          {wp || srcProject.path}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">
                          {selectedCount} session{selectedCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="relative">
                        <select
                          value={currentValue}
                          onChange={(e) => setProjectMapping(prev => ({
                            ...prev,
                            [srcProject.path]: e.target.value
                          }))}
                          className="w-full px-3 py-2 pr-8 bg-input border border-border rounded text-sm appearance-none"
                        >
                          <option value="">-- Select target project --</option>
                          <option value={CREATE_PROJECT_VALUE}>+ Create new project: &quot;{dirName}&quot;</option>
                          {projects
                            .filter(p => p && p.id && p.name)
                            .map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name}{p.rootPath === wp ? ' (matched)' : ''}
                              </option>
                            ))}
                        </select>
                        <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => setStep(ImportStep.PREVIEW_SESSIONS)}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:opacity-90"
                >
                  Back
                </button>
                <button
                  onClick={startImport}
                  disabled={!allMapped || loading}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                >
                  Start Import
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Progress */}
          {step === ImportStep.PROGRESS && (
            <div className="space-y-4 text-center py-8">
              <div className="text-lg">Importing sessions...</div>
              <div className="text-sm text-muted-foreground">
                This may take a few moments.
              </div>
            </div>
          )}

          {/* Step 5: Complete */}
          {step === ImportStep.COMPLETE && importResult && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2">Import Complete</h3>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Imported:</span>
                  <span className="font-medium">{importResult.imported}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Skipped:</span>
                  <span className="font-medium">{importResult.skipped}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Errors:</span>
                  <span className="font-medium text-destructive">{importResult.errors.length}</span>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2">Errors:</h4>
                  <div className="space-y-1 text-xs text-destructive max-h-40 overflow-y-auto">
                    {importResult.errors.map((err, idx) => (
                      <div key={idx}>
                        {err.sessionId}: {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer with close button (for non-complete steps) */}
        {step !== ImportStep.COMPLETE && step !== ImportStep.PROGRESS && (
          <div className="px-6 py-4 border-t border-border flex justify-end">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </>
  );
}
