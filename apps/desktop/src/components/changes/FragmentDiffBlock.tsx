import { useState } from 'react';
import { DiffViewer } from '../renderers/DiffViewer';
import type { EditFragment } from './useSessionChanges';

const WRITE_PREVIEW_LINES = 40;

interface FragmentDiffBlockProps {
  fragment: EditFragment;
  /** 1-based sequence number within the parent file (for "1)" "2)" labels) */
  index: number;
  filePath?: string;
}

export function FragmentDiffBlock({ fragment, index, filePath }: FragmentDiffBlockProps) {
  if (fragment.kind === 'edit') {
    return (
      <div className="space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-2">
          <span>{index})</span>
          <span>{fragment.toolName}</span>
          {fragment.replaceAll && (
            <span className="px-1 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300">
              replace_all
            </span>
          )}
        </div>
        <DiffViewer
          oldString={fragment.oldText}
          newString={fragment.newText}
          filePath={filePath}
        />
      </div>
    );
  }

  if (fragment.kind === 'write') {
    return (
      <WriteFragmentBlock
        content={fragment.content}
        index={index}
        toolName={fragment.toolName}
      />
    );
  }

  // notebook
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-2">
        <span>{index})</span>
        <span>NotebookEdit</span>
        <span className="px-1 rounded bg-muted text-muted-foreground/80">
          {fragment.editMode}
        </span>
        {fragment.cellId && (
          <span className="px-1 rounded bg-muted text-muted-foreground/80 truncate max-w-[180px]">
            cell: {fragment.cellId}
          </span>
        )}
      </div>
      <CodeBlock content={fragment.newSource} tone="add" />
    </div>
  );
}

function WriteFragmentBlock({
  content,
  index,
  toolName,
}: {
  content: string;
  index: number;
  toolName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = content.split(/\r?\n/);
  const truncated = !expanded && lines.length > WRITE_PREVIEW_LINES;
  const visibleLines = truncated ? lines.slice(0, WRITE_PREVIEW_LINES) : lines;
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-2">
        <span>{index})</span>
        <span>{toolName}</span>
        <span className="text-muted-foreground/60">· New file content ({lines.length} lines)</span>
      </div>
      <CodeBlock content={visibleLines.join('\n')} tone="add" />
      {truncated && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[10px] text-primary hover:underline"
        >
          Show {hiddenCount} more line{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

function CodeBlock({ content, tone }: { content: string; tone: 'add' | 'remove' }) {
  const toneClass =
    tone === 'add'
      ? 'bg-green-500/10 text-green-700 dark:text-green-300'
      : 'bg-red-500/10 text-red-700 dark:text-red-300';
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className={`overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] ${toneClass}`}>
        <pre className="text-xs leading-5 font-mono whitespace-pre px-3 py-1">
          {content}
        </pre>
      </div>
    </div>
  );
}
