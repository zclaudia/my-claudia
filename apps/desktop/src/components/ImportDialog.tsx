import { useState, useEffect } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useProjectStore } from '../stores/projectStore';

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

enum ImportStep {
  SELECT_DIRECTORY = 1,
  PREVIEW_SESSIONS = 2,
  CONFIGURE = 3,
  PROGRESS = 4,
  COMPLETE = 5
}

interface ScanResult {
  projects: Array<{
    path: string;
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

export function ImportDialog({ isOpen, onClose }: ImportDialogProps) {
  const [step, setStep] = useState(ImportStep.SELECT_DIRECTORY);
  const [claudeCliPath, setClaudeCliPath] = useState('~/.claude');
  const [scannedData, setScannedData] = useState<ScanResult | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const server = useServerStore((state) => state.getDefaultServer());
  const projects = useProjectStore((state) => state.projects);

  // Set default project when projects are loaded
  useEffect(() => {
    if (projects.length > 0 && !targetProjectId) {
      setTargetProjectId(projects[0].id);
    }
  }, [projects, targetProjectId]);

  // Ensure server URL has http:// prefix
  const getServerUrl = (): string => {
    const address = server?.address || 'localhost:3100';
    if (address.startsWith('http://') || address.startsWith('https://')) {
      return address;
    }
    return `http://${address}`;
  };

  // Reset state when closing
  const handleClose = () => {
    setStep(ImportStep.SELECT_DIRECTORY);
    setClaudeCliPath('~/.claude');
    setScannedData(null);
    setSelectedSessions(new Set());
    setTargetProjectId('');
    setImportResult(null);
    setError(null);
    setLoading(false);
    onClose();
  };

  // Step 1: Select directory
  const handleSelectDirectory = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use Electron dialog to select directory
      const result = await (window as any).electron?.openDialog({
        properties: ['openDirectory'],
        defaultPath: claudeCliPath
      });

      if (result && result.filePaths && result.filePaths[0]) {
        const selectedPath = result.filePaths[0];
        setClaudeCliPath(selectedPath);
        await scanDirectory(selectedPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to select directory');
    } finally {
      setLoading(false);
    }
  };

  // Scan directory for sessions
  const scanDirectory = async (path: string) => {
    try {
      setLoading(true);
      setError(null);

      // Server handles ~ expansion
      const response = await fetch(`${getServerUrl()}/api/import/claude-cli/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ claudeCliPath: path })
      });

      const result = await response.json();

      if (result.success) {
        setScannedData(result.data);
        setStep(ImportStep.PREVIEW_SESSIONS);
      } else {
        setError(result.error?.message || 'Failed to scan directory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan directory');
    } finally {
      setLoading(false);
    }
  };

  // Manually scan the typed path
  const handleManualScan = async () => {
    if (!claudeCliPath) {
      setError('Please enter a directory path');
      return;
    }
    await scanDirectory(claudeCliPath);
  };

  // Start import
  const startImport = async () => {
    if (!scannedData || selectedSessions.size === 0 || !targetProjectId) {
      setError('Please select sessions and target project');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setStep(ImportStep.PROGRESS);

      // Build imports array
      const imports = Array.from(selectedSessions).map(sessionId => {
        let projectPath = '';
        for (const project of scannedData.projects) {
          if (project.sessions.find(s => s.id === sessionId)) {
            projectPath = project.path;
            break;
          }
        }

        return {
          sessionId,
          projectPath,
          targetProjectId
        };
      });

      const response = await fetch(`${getServerUrl()}/api/import/claude-cli/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          claudeCliPath,
          imports,
          options: { conflictStrategy: 'skip' }
        })
      });

      const result = await response.json();

      if (result.success) {
        setImportResult(result.data);
        setStep(ImportStep.COMPLETE);
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
          <h2 className="text-xl font-semibold">Import from Claude CLI</h2>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Step 1: Select Directory */}
          {step === ImportStep.SELECT_DIRECTORY && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select the Claude CLI configuration directory to import sessions from.
              </p>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Claude CLI Directory
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={claudeCliPath}
                    onChange={(e) => setClaudeCliPath(e.target.value)}
                    placeholder="~/.claude"
                    className="flex-1 px-3 py-2 bg-input border border-border rounded text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleManualScan()}
                  />
                  <button
                    onClick={handleManualScan}
                    disabled={loading}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {loading ? 'Scanning...' : 'Scan'}
                  </button>
                  <button
                    onClick={handleSelectDirectory}
                    disabled={loading}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:opacity-90 disabled:opacity-50"
                  >
                    Browse...
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Enter the path to your Claude CLI directory (default: ~/.claude)
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Preview Sessions */}
          {step === ImportStep.PREVIEW_SESSIONS && scannedData && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Select the sessions you want to import. Found {scannedData.projects.reduce((sum, p) => sum + p.sessions.length, 0)} sessions across {scannedData.projects.length} projects.
              </p>

              {scannedData.projects.map(project => (
                <div key={project.path} className="border border-border rounded-lg p-4">
                  <h3 className="font-medium mb-3 text-sm">{project.path}</h3>

                  <div className="space-y-2">
                    {project.sessions.map(session => (
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

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => setStep(ImportStep.SELECT_DIRECTORY)}
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
                Configure import settings for {selectedSessions.size} session(s).
              </p>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Target Project
                </label>
                {projects.length > 0 ? (
                  <select
                    value={targetProjectId}
                    onChange={(e) => setTargetProjectId(e.target.value)}
                    className="w-full px-3 py-2 bg-input border border-border rounded text-sm"
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-3 bg-destructive/10 border border-destructive rounded text-sm text-destructive">
                    No projects available. Please create a project first before importing sessions.
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Sessions will be imported into the selected project.
                </p>
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
                  disabled={!targetProjectId || loading || projects.length === 0}
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
