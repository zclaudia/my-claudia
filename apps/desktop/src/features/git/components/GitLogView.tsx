import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import * as api from '../../../services/api';
import { useGitStore, selectLog } from '../store';

interface GitLogViewProps {
  projectId: string;
  worktreePath: string;
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

export function GitLogView({ projectId, worktreePath }: GitLogViewProps) {
  const log = useGitStore(selectLog(projectId, worktreePath));
  const setLog = useGitStore((s) => s.setLog);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getGitLog(projectId, worktreePath, 50);
      setLog(projectId, worktreePath, next);
    } finally {
      setLoading(false);
    }
  }, [projectId, worktreePath, setLog]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent Commits
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

      <div className="flex-1 overflow-y-auto">
        {!log ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">Loading…</div>
        ) : log.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">No commits.</div>
        ) : (
          <div className="divide-y divide-border">
            {log.map((c) => (
              <div key={c.sha} className="px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground">{c.shortSha}</span>
                  <span className="truncate font-medium">{c.message}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {c.author} · {relativeDate(c.date)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
