import { useState, useRef, useEffect, useCallback } from 'react';
import type { GitWorktree } from '@my-claudia/shared';
import * as api from '../../services/api';
import { SelectorTrigger } from './SelectorTrigger';

function pathBasename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
}

function pathRelative(from: string, to: string): string {
  const fromParts = from.replace(/\\/g, '/').split('/').filter(Boolean);
  const toParts = to.replace(/\\/g, '/').split('/').filter(Boolean);
  let i = 0;
  while (i < fromParts.length && fromParts[i] === toParts[i]) i++;
  const upCount = fromParts.length - i;
  const rel = [...Array(upCount).fill('..'), ...toParts.slice(i)].join('/');
  return rel || '.';
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

interface WorktreeSelectorProps {
  projectId: string;
  projectRootPath: string;
  currentWorktree: string;   // currentSession?.workingDirectory || ''
  onChange: (path: string) => void;
  disabled?: boolean;
  locked?: boolean;
  lockReason?: string;
}

function BranchIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm0 0c3.314 0 6-2.686 6-6m0-6a3 3 0 100 6 3 3 0 000-6z" />
    </svg>
  );
}

function LockIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 11c-1.657 0-3 1.343-3 3v2h6v-2c0-1.657-1.343-3-3-3zm6 3v2a2 2 0 01-2 2H7a2 2 0 01-2-2v-2a7 7 0 1114 0z" />
    </svg>
  );
}

/** Return a short, stable worktree label (prefer relative path over branch name). */
function getWorktreeLabel(worktreePath: string, projectRootPath: string): string {
  try {
    const rel = pathRelative(projectRootPath, worktreePath);
    return rel || pathBasename(worktreePath);
  } catch {
    return pathBasename(worktreePath);
  }
}

export function WorktreeSelector({
  projectId,
  projectRootPath,
  currentWorktree,
  onChange,
  disabled,
  locked,
  lockReason,
}: WorktreeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [createError, setCreateError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);

  // 外部点击关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
        setCreating(false);
        setNewBranch('');
        setCreateError('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // 显示创建表单时自动聚焦
  useEffect(() => {
    if (creating) branchInputRef.current?.focus();
  }, [creating]);

  const fetchWorktrees = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getProjectWorktrees(projectId);
      setWorktrees(list);
    } catch {
      // Avoid showing stale branch/worktree labels when fetch fails.
      setWorktrees([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Keep branch/worktree label accurate even before opening the dropdown.
  useEffect(() => {
    fetchWorktrees();
  }, [fetchWorktrees]);

  const handleOpen = () => {
    if (disabled || locked) return;
    if (!isOpen) fetchWorktrees();
    setIsOpen(!isOpen);
    setCreating(false);
    setNewBranch('');
    setCreateError('');
  };

  const handleSelect = (wtPath: string) => {
    onChange(wtPath);
    setIsOpen(false);
  };

  const handleCreate = async () => {
    const branch = newBranch.trim();
    if (!branch) return;
    setCreateError('');
    setLoading(true);
    try {
      const wt = await api.createProjectWorktree(projectId, branch);
      setWorktrees(prev => [...prev, wt]);
      setCreating(false);
      setNewBranch('');
      onChange(wt.path);
      setIsOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create worktree');
    } finally {
      setLoading(false);
    }
  };

  const hasOverride = Boolean(
    currentWorktree &&
    normalizePath(currentWorktree) !== normalizePath(projectRootPath)
  );
  const normalizedRootPath = normalizePath(projectRootPath);
  const currentWt = hasOverride
    ? worktrees.find(w => w.path === currentWorktree)
    : worktrees.find(w => normalizePath(w.path) === normalizedRootPath) || worktrees.find(w => w.isMain);
  const worktreeLabel = hasOverride
    ? getWorktreeLabel(currentWorktree, projectRootPath)
    : 'Root';
  const branchLabel = currentWt?.branch;
  const triggerLabel = branchLabel ? `${worktreeLabel} · ${branchLabel}` : worktreeLabel;
  const effectiveTitle = locked
    ? (lockReason || 'Worktree is locked for this session')
    : (currentWorktree || projectRootPath);

  return (
    <div ref={ref} className="relative">
      <SelectorTrigger
        onClick={handleOpen}
        disabled={disabled}
        locked={locked}
        lockReason={lockReason}
        title={effectiveTitle}
        className={[
          'max-w-[170px] sm:max-w-[260px]',
          (!disabled && !locked && hasOverride) ? 'text-primary' : '',
        ].join(' ')}
      >
        {locked ? <LockIcon /> : <BranchIcon />}
        <span className="hidden sm:inline-block min-w-0 max-w-[140px] truncate align-bottom sm:max-w-[220px]" title={triggerLabel}>
          {triggerLabel}
        </span>
        {locked && (
          <span className="hidden sm:inline text-[10px] uppercase tracking-wide font-semibold">Locked</span>
        )}
        <svg className={`w-3 h-3 ${locked ? 'text-amber-500/80' : 'text-muted-foreground'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </SelectorTrigger>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 w-[min(92vw,320px)] max-h-[320px] overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider border-b border-border">
            Worktree
          </div>

          {/* Root (默认) */}
          <button
            onClick={() => handleSelect('')}
            className={[
              'w-full text-left px-3 py-1.5 transition-colors',
              !hasOverride
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground hover:bg-muted active:bg-muted',
            ].join(' ')}
          >
            <div className="text-[13px]">Root (default)</div>
            <div className="text-[10px] text-muted-foreground mt-0.5 break-all whitespace-normal">{projectRootPath}</div>
          </button>

          <div className="my-1 border-t border-border" />

          {loading && (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">Loading...</div>
          )}

          {!loading && worktrees.length <= 1 && !creating && (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">No additional worktrees</div>
          )}

          {!loading && worktrees.filter(wt => !wt.isMain).map(wt => {
            const isSelected = currentWorktree === wt.path;
            let relPath = wt.path;
            try { relPath = pathRelative(projectRootPath, wt.path); } catch { /* ignore */ }
            return (
              <button
                key={wt.path}
                onClick={() => handleSelect(wt.path)}
                className={[
                  'w-full text-left px-3 py-1.5 transition-colors',
                  isSelected
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground hover:bg-muted active:bg-muted',
                ].join(' ')}
              >
                <div className="text-[13px]">{wt.branch}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 break-all whitespace-normal">{relPath}</div>
              </button>
            );
          })}

          {/* 创建新 worktree */}
          <div className="border-t border-border mt-1">
            {!creating ? (
              <button
                onClick={() => setCreating(true)}
                className="w-full text-left px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New worktree...
              </button>
            ) : (
              <div className="px-3 py-2">
                <div className="text-[10px] text-muted-foreground mb-1.5">Branch name</div>
                <input
                  ref={branchInputRef}
                  type="text"
                  value={newBranch}
                  onChange={e => { setNewBranch(e.target.value); setCreateError(''); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') { setCreating(false); setNewBranch(''); setCreateError(''); }
                  }}
                  placeholder="feat/my-feature"
                  className="w-full text-[12px] bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary"
                />
                {createError && (
                  <div className="text-[10px] text-destructive mt-1 break-words">{createError}</div>
                )}
                <div className="flex gap-1.5 mt-2">
                  <button
                    onClick={handleCreate}
                    disabled={!newBranch.trim() || loading}
                    className="flex-1 text-[11px] bg-primary text-primary-foreground rounded px-2 py-1 disabled:opacity-50"
                  >
                    {loading ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setCreating(false); setNewBranch(''); setCreateError(''); }}
                    className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
