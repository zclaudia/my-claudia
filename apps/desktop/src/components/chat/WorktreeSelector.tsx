import { useState, useRef, useEffect, useCallback } from 'react';
import type { GitWorktree } from '@my-claudia/shared';
import * as api from '../../services/api';

function pathBasename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
}

function pathDirname(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/') || '/';
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

interface WorktreeSelectorProps {
  projectId: string;
  projectRootPath: string;
  currentWorktree: string;   // currentSession?.workingDirectory || ''
  onChange: (path: string) => void;
  disabled?: boolean;
}

function BranchIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm0 0c3.314 0 6-2.686 6-6m0-6a3 3 0 100 6 3 3 0 000-6z" />
    </svg>
  );
}

/** 返回相对于 projectRootPath 的简短路径或分支名 */
function getDisplayLabel(worktreePath: string, projectRootPath: string, worktrees: GitWorktree[]): string {
  const wt = worktrees.find(w => w.path === worktreePath);
  if (wt) return wt.branch;
  try {
    const rel = pathRelative(pathDirname(projectRootPath), worktreePath);
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
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleOpen = () => {
    if (disabled) return;
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

  const hasOverride = Boolean(currentWorktree);
  const triggerLabel = hasOverride
    ? getDisplayLabel(currentWorktree, projectRootPath, worktrees)
    : 'Root';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        disabled={disabled}
        className={[
          'flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors h-7',
          disabled
            ? 'opacity-50 cursor-not-allowed text-muted-foreground'
            : hasOverride
              ? 'hover:bg-muted active:bg-muted/80 cursor-pointer text-primary'
              : 'hover:bg-muted active:bg-muted/80 cursor-pointer text-muted-foreground hover:text-foreground',
        ].join(' ')}
        title={currentWorktree || projectRootPath}
      >
        <BranchIcon />
        <span className="hidden md:inline truncate max-w-[80px] lg:max-w-none">{triggerLabel}</span>
        <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[220px] max-h-[320px] overflow-y-auto">
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
            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{projectRootPath}</div>
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
            try { relPath = pathRelative(pathDirname(projectRootPath), wt.path); } catch { /* ignore */ }
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
                <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{relPath}</div>
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
