import { useMemo } from 'react';

interface DiffViewerProps {
  oldString: string;
  newString: string;
  filePath?: string;
}

export type DiffLine = {
  type: 'add' | 'remove' | 'unchanged';
  content: string;
};

// Simple line-based diff using LCS (Longest Common Subsequence)
export function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'unchanged', content: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', content: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'remove', content: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

export function DiffViewer({ oldString, newString, filePath }: DiffViewerProps) {
  const diffLines = useMemo(
    () => computeDiff(oldString, newString),
    [oldString, newString]
  );

  const addCount = diffLines.filter((l) => l.type === 'add').length;
  const removeCount = diffLines.filter((l) => l.type === 'remove').length;

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      {/* Header with file name and stats */}
      <div className="px-3 py-1.5 bg-muted/50 border-b border-border flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-muted-foreground truncate">
          {filePath ? filePath.split('/').pop() : 'edit'}
        </span>
        <span className="text-xs flex gap-2 flex-shrink-0">
          {removeCount > 0 && (
            <span className="text-red-500 dark:text-red-400">-{removeCount}</span>
          )}
          {addCount > 0 && (
            <span className="text-green-500 dark:text-green-400">+{addCount}</span>
          )}
        </span>
      </div>

      {/* Diff lines */}
      <div className="overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch]">
        <pre className="text-xs leading-5 font-mono whitespace-pre">
          {diffLines.map((line, idx) => (
            <div
              key={idx}
              className={
                line.type === 'add'
                  ? 'bg-green-500/15 text-green-700 dark:text-green-300'
                  : line.type === 'remove'
                    ? 'bg-red-500/15 text-red-700 dark:text-red-300 line-through decoration-red-400/50'
                    : 'text-foreground'
              }
            >
              <span className="inline-block w-5 text-center text-muted-foreground/70 select-none">
                {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
              </span>
              <span>{line.content}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
