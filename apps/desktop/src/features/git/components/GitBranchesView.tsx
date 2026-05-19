import { useCallback, useEffect, useState } from 'react';
import { GitBranch as BranchIcon, RefreshCw } from 'lucide-react';
import * as api from '../../../services/api';
import { useGitStore, selectBranches } from '../store';

interface GitBranchesViewProps {
  projectId: string;
  worktreePath: string;
}

export function GitBranchesView({ projectId, worktreePath }: GitBranchesViewProps) {
  const branches = useGitStore(selectBranches(projectId, worktreePath));
  const setBranches = useGitStore((s) => s.setBranches);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getGitBranches(projectId, worktreePath);
      setBranches(projectId, worktreePath, next);
    } finally {
      setLoading(false);
    }
  }, [projectId, worktreePath, setBranches]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const local = branches?.filter((b) => !b.isRemote) ?? [];
  const remote = branches?.filter((b) => b.isRemote) ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Branches
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

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!branches ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : (
          <>
            <BranchSection title="Local" branches={local} />
            <BranchSection title="Remote" branches={remote} />
          </>
        )}
      </div>
    </div>
  );
}

function BranchSection({
  title,
  branches,
}: {
  title: string;
  branches: Array<{ name: string; isCurrent: boolean; upstream?: string }>;
}) {
  if (branches.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        {title} ({branches.length})
      </div>
      <div className="bg-card border border-border rounded divide-y divide-border">
        {branches.map((b) => (
          <div key={b.name} className="flex items-center justify-between px-2 py-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <BranchIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className={`text-xs truncate ${b.isCurrent ? 'font-semibold text-primary' : ''}`}>
                {b.name}
              </span>
              {b.isCurrent && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary flex-shrink-0">
                  current
                </span>
              )}
            </div>
            {b.upstream && (
              <span className="text-[10px] text-muted-foreground font-mono truncate ml-2" title={b.upstream}>
                {b.upstream}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
