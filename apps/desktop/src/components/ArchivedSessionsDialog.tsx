import { useState, useEffect, useMemo } from 'react';
import { useProjectStore } from '../stores/projectStore';
import * as api from '../services/api';
import type { Session } from '@my-claudia/shared';

interface ArchivedSessionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ArchivedSessionsDialog({ isOpen, onClose }: ArchivedSessionsDialogProps) {
  const [archivedSessions, setArchivedSessions] = useState<Session[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projects = useProjectStore((s) => s.projects) || [];

  const loadArchivedSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const sessions = await api.getArchivedSessions();
      setArchivedSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archived sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadArchivedSessions();
      setSelectedIds(new Set());
    }
  }, [isOpen]);

  // Group sessions by project
  const groupedSessions = useMemo(() => {
    const groups = new Map<string, { projectName: string; sessions: Session[] }>();

    for (const session of archivedSessions) {
      const key = session.projectId;
      if (!groups.has(key)) {
        const project = projects.find(p => p.id === session.projectId);
        groups.set(key, {
          projectName: project?.name || 'Unknown Project',
          sessions: []
        });
      }
      groups.get(key)!.sessions.push(session);
    }

    return Array.from(groups.entries());
  }, [archivedSessions, projects]);

  const handleRestore = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      setLoading(true);
      setError(null);
      await api.restoreSessions(ids);

      // Remove from local list
      setArchivedSessions(prev => prev.filter(s => !ids.includes(s.id)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });

      // Refresh main session list
      const sessions = await api.getSessions();
      useProjectStore.getState().setSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore sessions');
    } finally {
      setLoading(false);
    }
  };

  const handlePermanentDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      setLoading(true);
      setError(null);
      for (const id of ids) {
        await api.deleteSession(id);
      }

      // Remove from local list
      setArchivedSessions(prev => prev.filter(s => !ids.includes(s.id)));
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sessions');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(archivedSessions.map(s => s.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 z-50" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-h-[80vh] bg-card rounded-lg shadow-2xl z-50 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-semibold">Archived Sessions</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded hover:bg-secondary flex items-center justify-center"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        {archivedSessions.length > 0 && (
          <div className="px-6 py-3 border-b border-border flex items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={selectedIds.size === archivedSessions.length ? clearSelection : selectAll}
                className="px-3 py-1 text-xs bg-secondary text-secondary-foreground rounded hover:opacity-90"
              >
                {selectedIds.size === archivedSessions.length ? 'Clear All' : 'Select All'}
              </button>
              {selectedIds.size > 0 && (
                <span className="text-xs text-muted-foreground flex items-center">
                  {selectedIds.size} selected
                </span>
              )}
            </div>
            {selectedIds.size > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleRestore(Array.from(selectedIds))}
                  disabled={loading}
                  className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                >
                  Restore Selected
                </button>
                <button
                  onClick={() => handlePermanentDelete(Array.from(selectedIds))}
                  disabled={loading}
                  className="px-3 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:opacity-90 disabled:opacity-50"
                >
                  Delete Forever
                </button>
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive rounded text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Loading */}
          {loading && archivedSessions.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              Loading archived sessions...
            </div>
          )}

          {/* Empty state */}
          {!loading && archivedSessions.length === 0 && (
            <div className="text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              <p className="text-sm text-muted-foreground">No archived sessions</p>
            </div>
          )}

          {/* Session list grouped by project */}
          {groupedSessions.map(([projectId, group]) => (
            <div key={projectId} className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  {group.projectName}
                  <span className="ml-2 text-xs">({group.sessions.length})</span>
                </h3>
              </div>

              <div className="space-y-1">
                {group.sessions.map(session => (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 px-3 py-2 rounded hover:bg-secondary group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(session.id)}
                      onChange={() => toggleSelect(session.id)}
                      className="shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {session.name || 'Untitled Session'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Archived {session.archivedAt ? formatRelativeTime(session.archivedAt) : 'unknown'}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => handleRestore([session.id])}
                        disabled={loading}
                        className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
                        title="Restore"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => handlePermanentDelete([session.id])}
                        disabled={loading}
                        className="px-2 py-1 text-xs text-destructive hover:bg-destructive/10 rounded disabled:opacity-50"
                        title="Delete forever"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
