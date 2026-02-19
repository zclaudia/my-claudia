import { DiffViewer } from '../chat/DiffViewer';
import { CodeViewer } from '../chat/CodeViewer';

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

  // Default: raw JSON in pre tag
  return (
    <div className={`bg-muted/50 rounded-lg p-3 ${maxHeightClass} overflow-y-auto`}>
      <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-mono">
        {detail}
      </pre>
    </div>
  );
}
