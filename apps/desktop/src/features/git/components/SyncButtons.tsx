import { useState } from 'react';
import { Download, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import * as api from '../../../services/api';
import { runWithToast } from '../runWithToast';

interface SyncButtonsProps {
  projectId: string;
  worktreePath: string;
  onAfter?: () => void | Promise<void>;
}

export function SyncButtons({ projectId, worktreePath, onAfter }: SyncButtonsProps) {
  const [busy, setBusy] = useState<null | 'fetch' | 'pull' | 'push'>(null);

  const run = async (kind: 'fetch' | 'pull' | 'push') => {
    if (busy) return;
    setBusy(kind);
    const label = kind === 'fetch' ? 'Fetch' : kind === 'pull' ? 'Pull' : 'Push';
    const fn =
      kind === 'fetch'
        ? () => api.fetchGit(projectId, worktreePath)
        : kind === 'pull'
        ? () => api.pullGit(projectId, worktreePath)
        : () => api.pushGit(projectId, worktreePath);
    await runWithToast(label, projectId, fn);
    setBusy(null);
    if (onAfter) await onAfter();
  };

  const baseBtn =
    'inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-apple-sm transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50';

  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => run('fetch')} disabled={!!busy} className={baseBtn} title="git fetch origin">
        <Download className="w-3 h-3 opacity-70" />
        {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
      </button>
      <button type="button" onClick={() => run('pull')} disabled={!!busy} className={baseBtn} title="git pull --ff-only">
        <ArrowDownToLine className="w-3 h-3 opacity-70" />
        {busy === 'pull' ? 'Pulling…' : 'Pull'}
      </button>
      <button type="button" onClick={() => run('push')} disabled={!!busy} className={baseBtn} title="git push">
        <ArrowUpFromLine className="w-3 h-3 opacity-70" />
        {busy === 'push' ? 'Pushing…' : 'Push'}
      </button>
    </div>
  );
}
