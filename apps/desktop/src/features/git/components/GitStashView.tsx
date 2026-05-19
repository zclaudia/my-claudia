import { useCallback, useEffect, useState } from 'react';
import { Archive, RefreshCw, Trash2 } from 'lucide-react';
import * as api from '../../../services/api';
import { useGitStore, selectStash } from '../store';
import { runWithToast } from '../runWithToast';

interface GitStashViewProps {
  projectId: string;
  worktreePath: string;
  onAfterMutation?: () => void | Promise<void>;
}

function relativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function GitStashView({ projectId, worktreePath, onAfterMutation }: GitStashViewProps) {
  const stash = useGitStore(selectStash(projectId, worktreePath));
  const setStash = useGitStore((s) => s.setStash);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [stashMessage, setStashMessage] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getGitStash(projectId, worktreePath);
      setStash(projectId, worktreePath, next);
    } finally {
      setLoading(false);
    }
  }, [projectId, worktreePath, setStash]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    const ok = await runWithToast('Create stash', projectId, () =>
      api.createGitStash(projectId, worktreePath, stashMessage.trim() || undefined),
    );
    setCreating(false);
    if (ok !== null) {
      setStashMessage('');
      await refresh();
      if (onAfterMutation) await onAfterMutation();
    }
  };

  const handleApply = async (index: number) => {
    const ok = await runWithToast(`Apply stash@{${index}}`, projectId, () =>
      api.applyGitStash(projectId, worktreePath, index),
    );
    if (ok !== null) {
      await refresh();
      if (onAfterMutation) await onAfterMutation();
    }
  };

  const handleDrop = async (index: number) => {
    if (!window.confirm(`Drop stash@{${index}}? This cannot be undone.`)) return;
    const ok = await runWithToast(`Drop stash@{${index}}`, projectId, () =>
      api.dropGitStash(projectId, worktreePath, index),
    );
    if (ok !== null) await refresh();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Stashes ({stash?.length ?? 0})
        </span>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border space-y-2">
        <input
          type="text"
          value={stashMessage}
          onChange={(e) => setStashMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleCreate();
            }
          }}
          placeholder="Stash message (optional)"
          className="w-full text-xs px-2 py-1.5 rounded bg-background border border-border focus:border-primary outline-none"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="w-full text-xs py-1 rounded bg-secondary text-foreground hover:bg-secondary/80 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          <Archive className="w-3 h-3" />
          {creating ? 'Stashing…' : 'Stash working changes'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!stash ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">Loading…</div>
        ) : stash.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">No stashes.</div>
        ) : (
          <div className="divide-y divide-border">
            {stash.map((s) => (
              <div key={s.index} className="px-3 py-2 flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{s.message}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    stash@{`{${s.index}}`} · {relativeDate(s.date)}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleApply(s.index)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-foreground hover:bg-secondary/80"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDrop(s.index)}
                    className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
                    title="Drop stash"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
