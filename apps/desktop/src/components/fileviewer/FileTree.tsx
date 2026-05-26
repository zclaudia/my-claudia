import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { FileEntry } from '@my-claudia/shared';
import * as api from '../../services/api';

interface FileTreeProps {
  projectRoot: string;
  backendId?: string | null;
  selectedPath?: string | null;
  onOpenFile: (relativePath: string) => void;
}

type EntryMap = Record<string, FileEntry[]>;
type FlagMap = Record<string, boolean>;
type ErrorMap = Record<string, string | null>;

function entryIndent(depth: number) {
  return { paddingLeft: `${0.5 + depth * 0.875}rem` };
}

function parentPath(path: string) {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function shouldAutoExpand(selectedPath: string | null | undefined, dirPath: string) {
  if (!selectedPath) return false;
  return parentPath(selectedPath) === dirPath || selectedPath.startsWith(`${dirPath}/`);
}

export function FileTree({ projectRoot, backendId, selectedPath, onOpenFile }: FileTreeProps) {
  const [entriesByPath, setEntriesByPath] = useState<EntryMap>({});
  const [expandedPaths, setExpandedPaths] = useState<FlagMap>({ '': true });
  const [loadingPaths, setLoadingPaths] = useState<FlagMap>({});
  const [errorByPath, setErrorByPath] = useState<ErrorMap>({});

  const loadDirectory = useCallback(async (relativePath: string) => {
    setLoadingPaths((state) => ({ ...state, [relativePath]: true }));
    setErrorByPath((state) => ({ ...state, [relativePath]: null }));

    try {
      const result = await api.listDirectory({
        projectRoot,
        relativePath,
        backendId: backendId ?? undefined,
      });
      setEntriesByPath((state) => ({ ...state, [relativePath]: result.entries }));
    } catch (err) {
      setErrorByPath((state) => ({
        ...state,
        [relativePath]: err instanceof Error ? err.message : 'Failed to load directory',
      }));
    } finally {
      setLoadingPaths((state) => ({ ...state, [relativePath]: false }));
    }
  }, [backendId, projectRoot]);

  useEffect(() => {
    setEntriesByPath({});
    setExpandedPaths({ '': true });
    setLoadingPaths({});
    setErrorByPath({});
    void loadDirectory('');
  }, [loadDirectory]);

  const toggleDirectory = (path: string) => {
    const willExpand = !expandedPaths[path];
    setExpandedPaths((state) => ({ ...state, [path]: willExpand }));
    if (willExpand && !entriesByPath[path]) {
      void loadDirectory(path);
    }
  };

  const renderEntries = (relativePath: string, depth: number): ReactNode => {
    const entries = entriesByPath[relativePath] ?? [];
    const loading = loadingPaths[relativePath];
    const error = errorByPath[relativePath];

    return (
      <>
        {error && (
          <div className="px-2 py-1 text-xs text-destructive" style={entryIndent(depth)}>
            {error}
          </div>
        )}
        {loading && !entries.length && (
          <div className="px-2 py-1 text-xs text-muted-foreground" style={entryIndent(depth)}>
            Loading...
          </div>
        )}
        {entries.map((entry) => {
          const isDirectory = entry.type === 'directory';
          const isExpanded = !!expandedPaths[entry.path];
          const isSelected = !isDirectory && selectedPath === entry.path;
          const autoExpand = isDirectory && shouldAutoExpand(selectedPath, entry.path);
          const showChildren = isDirectory && (isExpanded || autoExpand);

          return (
            <div key={entry.path}>
              <button
                type="button"
                onClick={() => isDirectory ? toggleDirectory(entry.path) : onOpenFile(entry.path)}
                className={`w-full flex items-center gap-1.5 px-2 py-1 text-left text-xs font-mono min-w-0 ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
                style={entryIndent(depth)}
                title={entry.path}
              >
                <span className="w-3 flex-shrink-0 text-[10px] opacity-70">
                  {isDirectory ? (showChildren ? 'v' : '>') : ''}
                </span>
                <span className="w-3 flex-shrink-0 text-[10px] opacity-80">
                  {isDirectory ? 'D' : 'F'}
                </span>
                <span className="truncate">{entry.name}</span>
              </button>
              {showChildren && renderEntries(entry.path, depth + 1)}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div className="h-full overflow-auto border-r border-border bg-card/40" data-testid="file-tree">
      <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground border-b border-border">
        Files
      </div>
      <div className="py-1">
        {renderEntries('', 0)}
      </div>
    </div>
  );
}
