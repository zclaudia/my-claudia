import { useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Maximize2, X } from 'lucide-react';
import { DiffViewer } from '../chat/DiffViewer';
import { CodeViewer } from '../chat/CodeViewer';
import { useAndroidBack } from '../../hooks/useAndroidBack';

interface PermissionDetailViewProps {
  toolName: string;
  detail: string;
  /** Max height class for the container. Defaults to 'max-h-48' */
  maxHeightClass?: string;
}

/**
 * Parse the detail JSON back into the original toolInput object.
 * Returns null if parsing fails.
 */
function parseToolInput(detail: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not valid JSON — fall through to raw display
  }
  return null;
}

/**
 * Renders tool-specific formatted detail for permission requests.
 * Edit → DiffViewer, Write → CodeViewer, Bash → terminal-style, etc.
 * Falls back to raw JSON for unrecognized tools.
 */
export function PermissionDetailView({ toolName, detail, maxHeightClass = 'max-h-48' }: PermissionDetailViewProps) {
  const input = parseToolInput(detail);

  // Edit tool: show file path + diff
  if (toolName === 'Edit' && input?.old_string && input?.new_string) {
    return (
      <div className={`${maxHeightClass} overflow-y-auto`}>
        {input.file_path ? (
          <div className="text-xs font-mono text-muted-foreground mb-2 truncate">
            {String(input.file_path)}
          </div>
        ) : null}
        <DiffViewer
          oldString={String(input.old_string)}
          newString={String(input.new_string)}
          filePath={input.file_path ? String(input.file_path) : undefined}
        />
      </div>
    );
  }

  // Write tool: show file content with syntax highlighting
  if (toolName === 'Write' && input?.content) {
    return (
      <div className={`${maxHeightClass} overflow-y-auto`}>
        <CodeViewer
          content={String(input.content)}
          filePath={input.file_path ? String(input.file_path) : undefined}
          maxLines={15}
        />
      </div>
    );
  }

  // Bash tool: terminal-style command display
  if (toolName === 'Bash' && input?.command) {
    return (
      <div className={`${maxHeightClass} overflow-y-auto`}>
        <div className="rounded-lg overflow-hidden border border-zinc-700">
          <pre className="text-xs font-mono p-2 bg-zinc-900 text-green-400 overflow-x-auto whitespace-pre-wrap break-words">
            <span className="text-zinc-500 select-none">$ </span>{String(input.command)}
          </pre>
        </div>
        {input.description ? (
          <div className="text-xs text-muted-foreground mt-1.5">
            {String(input.description)}
          </div>
        ) : null}
      </div>
    );
  }

  // Read tool: just show file path prominently
  if (toolName === 'Read' && input?.file_path) {
    return (
      <div className="bg-muted/50 rounded-lg p-3">
        <div className="text-xs font-mono text-foreground break-all">
          {String(input.file_path)}
        </div>
        {(input.offset || input.limit) ? (
          <div className="text-xs text-muted-foreground mt-1">
            {input.offset ? `offset: ${input.offset}` : ''}
            {input.offset && input.limit ? ', ' : ''}
            {input.limit ? `limit: ${input.limit}` : ''}
          </div>
        ) : null}
      </div>
    );
  }

  // Grep/Glob: show pattern + path
  if ((toolName === 'Grep' || toolName === 'Glob') && input?.pattern) {
    return (
      <div className="bg-muted/50 rounded-lg p-3">
        <div className="text-xs font-mono text-foreground">
          <span className="text-muted-foreground">pattern: </span>
          <span className="text-primary">{String(input.pattern)}</span>
        </div>
        {input.path ? (
          <div className="text-xs font-mono text-foreground mt-1">
            <span className="text-muted-foreground">path: </span>
            {String(input.path)}
          </div>
        ) : null}
      </div>
    );
  }

  // ExitPlanMode: render plan as markdown + allowedPrompts as a list
  if (toolName === 'ExitPlanMode' && input) {
    return <ExitPlanModeDetail input={input} maxHeightClass={maxHeightClass} />;
  }

  // Default: raw JSON in pre tag
  return (
    <div className={`bg-muted/50 rounded-lg p-3 ${maxHeightClass} overflow-y-auto`}>
      <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-mono">
        {detail}
      </pre>
    </div>
  );
}

/** ExitPlanMode detail with fullscreen expand support */
function ExitPlanModeDetail({ input, maxHeightClass }: { input: Record<string, unknown>; maxHeightClass: string }) {
  const [expanded, setExpanded] = useState(false);
  const allowedPrompts = input.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined;
  const plan = input.plan as string | undefined;

  useAndroidBack(() => setExpanded(false), expanded, 40);

  const permissionsBlock = allowedPrompts && allowedPrompts.length > 0 ? (
    <div className="bg-muted/50 rounded-lg p-3">
      <div className="text-xs font-medium text-muted-foreground mb-1.5">Requested permissions</div>
      {allowedPrompts.map((p, i) => (
        <div key={i} className="flex items-start gap-2 text-xs mt-1">
          <span className="font-mono text-primary shrink-0">{p.tool}</span>
          <span className="text-foreground">{p.prompt}</span>
        </div>
      ))}
    </div>
  ) : null;

  const planBlock = plan ? (
    <div className="prose prose-sm prose-invert max-w-none text-xs [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_p]:text-xs [&_li]:text-xs [&_code]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
    </div>
  ) : null;

  return (
    <>
      <div className={`${maxHeightClass} overflow-y-auto space-y-3 relative`}>
        {permissionsBlock}
        {planBlock}
        {/* Expand button */}
        {plan && (
          <button
            onClick={() => setExpanded(true)}
            className="sticky bottom-0 w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground bg-gradient-to-t from-card via-card/95 to-transparent hover:text-foreground transition-colors"
          >
            <Maximize2 size={12} />
            View full plan
          </button>
        )}
      </div>

      {/* Fullscreen overlay via portal */}
      {expanded && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative w-full h-full sm:w-[90vw] sm:max-w-3xl sm:h-auto sm:max-h-[80vh] bg-card sm:border sm:border-border sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border safe-top-pad">
              <span className="text-sm font-medium text-card-foreground">Plan Details</span>
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 safe-bottom-pad">
              {permissionsBlock}
              {plan && (
                <div className="prose prose-sm prose-invert max-w-none text-sm [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_p]:text-sm [&_li]:text-sm [&_code]:text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
