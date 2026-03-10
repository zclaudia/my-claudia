import { useState, useMemo, memo } from 'react';
import { AnsiUp } from 'ansi_up';
import type { ToolCallState } from '../../stores/chatStore';
import { getToolIcon } from '../../config/icons';
import { Icon } from '../ui/Icon';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Wrench, Square } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { CodeViewer } from './CodeViewer';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useServerStore } from '../../stores/serverStore';
import { toolRendererRegistry } from '../../services/toolRendererRegistry';

const ansiUp = new AnsiUp();

interface ToolCallItemProps {
  toolCall: ToolCallState;
}

// Normalize tool input: some providers send stringified JSON instead of objects
function normalizeToolInput(input: unknown): unknown {
  if (typeof input === 'string') {
    try { return JSON.parse(input); } catch { return input; }
  }
  return input;
}

// Format tool input for display
function formatToolInput(toolName: string, input: unknown): string {
  input = normalizeToolInput(input);
  if (!input || typeof input !== 'object') {
    return JSON.stringify(input, null, 2);
  }

  const obj = input as Record<string, unknown>;

  switch (toolName) {
    case 'Read':
      return obj.file_path as string || JSON.stringify(input);
    case 'Write':
      return obj.file_path as string || JSON.stringify(input);
    case 'Edit':
      return obj.file_path as string || JSON.stringify(input);
    case 'Bash':
      return obj.command as string || JSON.stringify(input);
    case 'Grep':
      return `${obj.pattern || ''} ${obj.path ? `in ${obj.path}` : ''}`;
    case 'Glob':
      return `${obj.pattern || ''} ${obj.path ? `in ${obj.path}` : ''}`;
    case 'Task':
      return obj.description as string || JSON.stringify(input);
    case 'WebFetch':
      return obj.url as string || JSON.stringify(input);
    case 'WebSearch':
      return obj.query as string || JSON.stringify(input);
    case 'AskUserQuestion': {
      const questions = (obj.questions as Array<{ question: string }>) || [];
      return `${questions.length} question${questions.length !== 1 ? 's' : ''}`;
    }
    case 'ExitPlanMode': {
      // Try to extract a meaningful summary from plan data
      let planText = '';

      if (obj.plan) {
        if (typeof obj.plan === 'string') {
          planText = obj.plan;
        } else if (typeof obj.plan === 'object') {
          planText = JSON.stringify(obj.plan);
        }
      } else if (obj.plan_file && typeof obj.plan_file === 'string') {
        planText = obj.plan_file;
      } else if (Object.keys(obj).length > 0) {
        planText = JSON.stringify(obj);
      }

      const firstLine = planText.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') || 'Plan ready for review';
      return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
    }
    case 'EnterPlanMode':
      return 'Entering plan mode';
    case 'TodoWrite':
      return 'Update task list';
    default:
      return JSON.stringify(input, null, 2);
  }
}

// Format tool result for display (no truncation — UI handles collapse/expand)
function formatToolResult(result: unknown): string {
  if (typeof result === 'string') {
    return result.trim();
  }
  return JSON.stringify(result, null, 2);
}

// Convert ANSI escape sequences to styled HTML
function ansiToHtml(text: string): string {
  return ansiUp.ansi_to_html(text);
}

// Max lines to show before collapsing terminal output
const TERMINAL_PREVIEW_LINES = 10;

// Button to run a command in the remote terminal
function RunInTerminalButton({ command }: { command: string }) {
  const { sendMessage } = useConnection();
  const hasTerminal = useServerStore.getState().activeServerSupports('remoteTerminal');

  if (!hasTerminal) return null;

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        const { selectedSessionId, sessions } = useProjectStore.getState();
        const session = sessions.find(s => s.id === selectedSessionId);
        if (!session?.projectId) return;

        const store = useTerminalStore.getState();
        if (!store.terminals[session.projectId]) {
          store.openTerminal(session.projectId);
        }
        store.setDrawerOpen(session.projectId, true);
        store.setBottomPanelTab('terminal');

        const terminalId = useTerminalStore.getState().terminals[session.projectId];
        if (terminalId) {
          await useTerminalStore.getState().waitForReady(terminalId);
          sendMessage({ type: 'terminal_input', terminalId, data: command });
        }
      }}
      className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover/cmd:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-opacity"
      title="Paste to terminal"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </button>
  );
}

// Terminal-style output for Bash commands
function TerminalOutput({ content, isError }: { content: string; isError?: boolean }) {
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const lines = content.split('\n');
  const needsCollapse = lines.length > TERMINAL_PREVIEW_LINES;
  const displayContent = needsCollapse && !isFullyExpanded
    ? lines.slice(0, TERMINAL_PREVIEW_LINES).join('\n')
    : content;

  const html = useMemo(() => ansiToHtml(displayContent), [displayContent]);

  return (
    <div className="rounded-lg overflow-hidden border border-zinc-700">
      <pre
        data-testid="tool-result"
        className={`text-xs font-mono p-3 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre ${
          isError
            ? 'bg-red-950 text-red-300'
            : 'bg-zinc-900 text-zinc-200'
        }`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {needsCollapse && (
        <button
          onClick={() => setIsFullyExpanded(!isFullyExpanded)}
          className="w-full px-3 py-1.5 text-xs text-zinc-400 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 transition-colors text-center"
        >
          {isFullyExpanded
            ? 'Collapse'
            : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

// Plan content with lightweight markdown rendering
const PLAN_PREVIEW_LINES = 20;

function PlanContent({ content }: { content: string }) {
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const lines = content.split('\n');
  const needsCollapse = lines.length > PLAN_PREVIEW_LINES;
  const displayLines = needsCollapse && !isFullyExpanded
    ? lines.slice(0, PLAN_PREVIEW_LINES)
    : lines;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 bg-primary/5 text-xs space-y-0.5">
        {displayLines.map((line, i) => {
          const trimmed = line.trimStart();
          // Headings
          if (trimmed.startsWith('### '))
            return <div key={i} className="font-semibold text-foreground mt-2 mb-0.5">{trimmed.slice(4)}</div>;
          if (trimmed.startsWith('## '))
            return <div key={i} className="font-bold text-foreground mt-3 mb-0.5 text-sm">{trimmed.slice(3)}</div>;
          if (trimmed.startsWith('# '))
            return <div key={i} className="font-bold text-foreground mt-3 mb-1 text-base">{trimmed.slice(2)}</div>;
          // List items
          if (trimmed.startsWith('- ') || trimmed.startsWith('* '))
            return <div key={i} className="ml-3 text-foreground">• {trimmed.slice(2)}</div>;
          if (/^\d+\.\s/.test(trimmed)) {
            const match = trimmed.match(/^(\d+\.)\s(.*)$/);
            return <div key={i} className="ml-3 text-foreground"><span className="text-muted-foreground">{match?.[1]}</span> {match?.[2]}</div>;
          }
          // Code blocks (inline indicator)
          if (trimmed.startsWith('```'))
            return <div key={i} className="text-muted-foreground font-mono">{trimmed}</div>;
          // Bold text
          if (trimmed.includes('**')) {
            const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
            return (
              <div key={i} className="text-foreground">
                {parts.map((part, j) =>
                  part.startsWith('**') && part.endsWith('**')
                    ? <strong key={j}>{part.slice(2, -2)}</strong>
                    : part
                )}
              </div>
            );
          }
          // Empty line
          if (!trimmed) return <div key={i} className="h-1" />;
          // Regular text
          return <div key={i} className="text-foreground">{line}</div>;
        })}
      </div>
      {needsCollapse && (
        <button
          onClick={() => setIsFullyExpanded(!isFullyExpanded)}
          className="w-full px-3 py-1.5 text-xs text-muted-foreground bg-muted/50 hover:bg-muted active:bg-muted/80 transition-colors text-center border-t border-border"
        >
          {isFullyExpanded ? 'Collapse' : `Show full plan (${lines.length} lines)`}
        </button>
      )}
    </div>
  );
}

// Render expanded content based on tool type
function ToolExpandedContent({ toolName, toolInput, status, result, isError }: {
  toolName: string;
  toolInput: unknown;
  status: ToolCallState['status'];
  result?: unknown;
  isError?: boolean;
}) {
  // Check for custom plugin tool renderer
  const CustomRenderer = toolRendererRegistry.get(toolName);
  if (CustomRenderer) {
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <CustomRenderer
          toolName={toolName}
          toolInput={toolInput}
          toolResult={result}
          isError={isError}
          isLoading={status === 'running'}
        />
      </div>
    );
  }

  const input = normalizeToolInput(toolInput) as Record<string, unknown> | undefined;

  // Edit tool: show inline diff
  if (toolName === 'Edit' && input?.old_string && input?.new_string) {
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2">
          <DiffViewer
            oldString={String(input.old_string)}
            newString={String(input.new_string)}
            filePath={input.file_path ? String(input.file_path) : undefined}
          />
        </div>
        {/* Show result only if there's an error */}
        {status !== 'running' && isError && result !== undefined && (
          <div className="mt-2">
            <pre
              data-testid="tool-result"
              className="text-xs rounded p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre bg-destructive/20 text-destructive"
            >
              {formatToolResult(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Write tool: show file content with syntax highlighting
  if (toolName === 'Write' && input?.content) {
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2">
          <CodeViewer
            content={String(input.content)}
            filePath={input.file_path ? String(input.file_path) : undefined}
          />
        </div>
        {status !== 'running' && isError && result !== undefined && (
          <div className="mt-2">
            <pre
              data-testid="tool-result"
              className="text-xs rounded p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre bg-destructive/20 text-destructive"
            >
              {formatToolResult(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Read tool: show file content with syntax highlighting
  if (toolName === 'Read' && status !== 'running' && result !== undefined) {
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2">
          <CodeViewer
            content={formatToolResult(result)}
            filePath={input?.file_path ? String(input.file_path) : undefined}
          />
        </div>
      </div>
    );
  }

  // Bash tool: terminal-style rendering
  if (toolName === 'Bash') {
    const command = input?.command ? String(input.command) : '';
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        {/* Command */}
        {command && (
          <div className="mt-2">
            <div className="rounded-lg overflow-hidden border border-border">
              <pre className="text-xs font-mono p-2 bg-secondary text-success overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre relative group/cmd">
                <span className="text-muted-foreground select-none">$ </span>{command}
                <RunInTerminalButton command={command} />
              </pre>
            </div>
          </div>
        )}
        {/* Output */}
        {status !== 'running' && result !== undefined && (
          <div className="mt-2">
            <TerminalOutput content={formatToolResult(result)} isError={isError} />
          </div>
        )}
      </div>
    );
  }

  // AskUserQuestion: show formatted questions and user's answer
  if (toolName === 'AskUserQuestion' && input?.questions) {
    const questions = input.questions as Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description: string }>;
      multiSelect?: boolean;
    }>;

    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2 space-y-3">
          {questions.map((q, idx) => (
            <div key={idx}>
              <div className="flex items-start gap-2 mb-1.5">
                <span className="inline-block px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded font-medium flex-shrink-0">
                  {q.header}
                </span>
                <span className="text-xs text-foreground">{q.question}</span>
              </div>
              <div className="ml-2 space-y-1">
                {q.options.map((opt) => (
                  <div key={opt.label} className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground flex-shrink-0">{q.multiSelect ? '☐' : '○'}</span>
                    <div>
                      <span className="text-foreground">{opt.label}</span>
                      {opt.description && (
                        <span className="text-muted-foreground ml-1">- {opt.description}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Show user's answer (comes as the deny message) */}
        {status !== 'running' && result !== undefined && (
          <div className="mt-3">
            <div className="text-xs text-muted-foreground mb-1">User's Answer:</div>
            <pre className="text-xs bg-primary/10 rounded p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre text-foreground">
              {formatToolResult(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // ExitPlanMode: show plan content formatted
  if (toolName === 'ExitPlanMode') {
    // Try to get plan content from various possible formats
    let planContent = '';

    if (input?.plan) {
      // Check if plan is a string (direct content)
      if (typeof input.plan === 'string') {
        planContent = input.plan;
      }
      // Check if plan is an object (might have file path or other structure)
      else if (typeof input.plan === 'object') {
        planContent = JSON.stringify(input.plan, null, 2);
      }
    } else if (input?.plan_file && typeof input.plan_file === 'string') {
      // If there's a plan_file field, show a message about it
      planContent = `# Plan\n\nPlan file: ${input.plan_file}\n\nThe plan content will be displayed after approval.`;
    } else if (Object.keys(input || {}).length > 0) {
      // If no plan field but has other fields, display them nicely
      planContent = `# Plan Details\n\n${JSON.stringify(input, null, 2)}`;
    } else {
      // Fallback message
      planContent = '# Plan\n\nPlan ready for review.';
    }

    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2">
          <PlanContent content={planContent} />
        </div>
        {status !== 'running' && result !== undefined && (
          <div className="mt-2">
            <pre
              data-testid="tool-result"
              className={`text-xs rounded p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre ${
                isError ? 'bg-destructive/20 text-destructive' : 'bg-primary/10 text-foreground'
              }`}
            >
              {formatToolResult(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // TodoWrite: show task list
  if (toolName === 'TodoWrite' && input?.todos) {
    const todos = input.todos as Array<{ content: string; status: string }>;
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2 space-y-1">
          {todos.map((todo, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="flex-shrink-0">
                {todo.status === 'completed' ? <CheckCircle2 size={12} className="text-success" /> : todo.status === 'in_progress' ? <Loader2 size={12} className="animate-spin text-primary" /> : <Square size={12} className="text-muted-foreground" />}
              </span>
              <span className={todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default: generic JSON input + result
  return (
    <div className="px-3 pb-3 border-t border-border/50">
      {/* Input */}
      <div className="mt-2">
        <div className="text-xs text-muted-foreground mb-1">Input:</div>
        <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] text-foreground whitespace-pre">
          {JSON.stringify(toolInput, null, 2)}
        </pre>
      </div>

      {/* Result */}
      {status !== 'running' && result !== undefined && (
        <div className="mt-2">
          <div className="text-xs text-muted-foreground mb-1">
            {isError ? 'Error:' : 'Result:'}
          </div>
          <pre
            data-testid="tool-result"
            className={`text-xs rounded p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] max-h-96 overflow-y-auto whitespace-pre ${
              isError
                ? 'bg-destructive/20 text-destructive'
                : 'bg-muted/50 text-foreground'
            }`}
          >
            {formatToolResult(result)}
          </pre>
        </div>
      )}
    </div>
  );
}

export const ToolCallItem = memo(function ToolCallItem({ toolCall }: ToolCallItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { toolName, toolInput, status, result, isError, activity } = toolCall;

  const icon = getToolIcon(toolName);
  const summary = formatToolInput(toolName, toolInput);

  // AskUserQuestion: user answers come back as "deny" (isError=true), but that's expected behavior
  const showAsError = isError && toolName !== 'AskUserQuestion';

  return (
    <div
      data-testid="tool-use"
      className={`my-2 rounded-xl shadow-apple-sm border ${
        status === 'running'
          ? 'border-primary/30 bg-primary/5'
          : showAsError
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-success/30 bg-success/5'
      }`}
    >
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 active:bg-muted/50 rounded-lg transition-colors"
      >
        {/* Status indicator */}
        {status === 'running' ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : showAsError ? (
          <XCircle size={14} className="text-destructive" />
        ) : (
          <CheckCircle2 size={14} className="text-success" />
        )}

        {/* Tool icon and name */}
        <Icon icon={icon} size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground" data-testid="tool-name">{toolName}</span>

        {/* Summary */}
        <span className="flex-1 text-xs text-muted-foreground truncate ml-2">
          {summary}
        </span>

        {/* Expand/collapse indicator */}
        <span className="text-muted-foreground">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {/* Subagent activity indicator — shows what the Agent is currently doing */}
      {status === 'running' && activity && toolName === 'Agent' && (
        <div className="px-3 pb-2 -mt-1">
          <div className="text-[11px] text-muted-foreground truncate pl-6">
            {activity}
          </div>
        </div>
      )}

      {/* Expanded content — tool-specific rendering */}
      {isExpanded && (
        <ToolExpandedContent
          toolName={toolName}
          toolInput={toolInput}
          status={status}
          result={result}
          isError={isError}
        />
      )}
    </div>
  );
});

interface ToolCallListProps {
  toolCalls: ToolCallState[];
  defaultCollapsed?: boolean;
}

// Get a short summary of what a tool call did
function getToolCallSummary(tc: ToolCallState): string {
  const input = normalizeToolInput(tc.toolInput) as Record<string, unknown> | undefined;
  if (!input) return tc.toolName;

  switch (tc.toolName) {
    case 'Read':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Read';
    case 'Write':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Write';
    case 'Edit':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Edit';
    case 'Bash':
      const cmd = String(input.command || '').split(' ')[0];
      return cmd || 'bash';
    case 'Grep':
      return `grep ${String(input.pattern || '').substring(0, 15)}`;
    case 'Glob':
      return `glob ${String(input.pattern || '').substring(0, 15)}`;
    case 'Task':
      return String(input.description || 'task').substring(0, 20);
    case 'WebFetch':
      try {
        const url = new URL(String(input.url || ''));
        return url.hostname;
      } catch {
        return 'fetch';
      }
    case 'WebSearch':
      return String(input.query || '').substring(0, 15);
    case 'TodoWrite':
      return 'Update todos';
    case 'AskUserQuestion': {
      const questions = (input.questions as Array<{ header: string }>) || [];
      return questions[0]?.header || 'question';
    }
    case 'ExitPlanMode': {
      let planText = '';

      if (input.plan) {
        if (typeof input.plan === 'string') {
          planText = input.plan;
        } else if (typeof input.plan === 'object') {
          planText = JSON.stringify(input.plan);
        }
      } else if (input.plan_file && typeof input.plan_file === 'string') {
        planText = input.plan_file;
      } else if (Object.keys(input).length > 0) {
        planText = JSON.stringify(input);
      }

      const title = planText.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') || 'Plan';
      return title.substring(0, 25);
    }
    case 'EnterPlanMode':
      return 'Enter plan mode';
    default:
      return tc.toolName;
  }
}

// Get status icon as Lucide component
function getStatusIconComponent(status: ToolCallState['status']) {
  switch (status) {
    case 'completed': return <CheckCircle2 size={10} className="text-success" />;
    case 'error': return <XCircle size={10} className="text-destructive" />;
    case 'running': return <Loader2 size={10} className="animate-spin text-primary" />;
    default: return null;
  }
}

const MAX_VISIBLE_TOOLS = 5;

export const ToolCallList = memo(function ToolCallList({ toolCalls, defaultCollapsed = false }: ToolCallListProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [showAll, setShowAll] = useState(false);

  if (toolCalls.length === 0) return null;

  // When collapsed, show a detailed summary of each tool call
  if (isCollapsed) {
    const completedCount = toolCalls.filter(tc => tc.status === 'completed').length;
    const errorCount = toolCalls.filter(tc => tc.status === 'error').length;
    const runningCount = toolCalls.filter(tc => tc.status === 'running').length;

    return (
      <div
        onClick={() => setIsCollapsed(false)}
        className="px-3 py-2 text-xs bg-muted/50 rounded-lg hover:bg-muted transition-colors cursor-pointer"
      >
        {/* Header with counts */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="flex items-center gap-1 text-foreground font-medium">
            <Wrench size={12} className="text-muted-foreground" />
            {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            {completedCount > 0 && <span className="flex items-center gap-0.5 text-success"><CheckCircle2 size={10} />{completedCount}</span>}
            {errorCount > 0 && <span className="flex items-center gap-0.5 text-destructive ml-1"><XCircle size={10} />{errorCount}</span>}
            {runningCount > 0 && <span className="flex items-center gap-0.5 text-primary ml-1"><Loader2 size={10} className="animate-spin" />{runningCount}</span>}
          </span>
          <span className="flex items-center gap-0.5 text-muted-foreground ml-auto text-[10px]">Click to expand <ChevronRight size={10} /></span>
        </div>
        {/* Brief list of each tool call */}
        <div className="flex flex-wrap gap-1.5">
          {toolCalls.map((tc, idx) => (
            <span
              key={tc.id || idx}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                tc.status === 'error'
                  ? 'bg-destructive/20 text-destructive'
                  : tc.status === 'running'
                  ? 'bg-primary/20 text-primary'
                  : 'bg-secondary text-muted-foreground'
              }`}
              title={formatToolInput(tc.toolName, tc.toolInput)}
            >
              <span>{getStatusIconComponent(tc.status)}</span>
              <span className="truncate max-w-[120px]">{getToolCallSummary(tc)}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Auto-collapse if there are more than MAX_VISIBLE_TOOLS
  const hasMany = toolCalls.length > MAX_VISIBLE_TOOLS;
  const visibleToolCalls = showAll || !hasMany
    ? toolCalls
    : toolCalls.slice(-MAX_VISIBLE_TOOLS);
  const hiddenCount = toolCalls.length - visibleToolCalls.length;

  return (
    <div className="space-y-1">
      {/* Collapse button */}
      {defaultCollapsed && (
        <button
          onClick={() => setIsCollapsed(true)}
          className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown size={12} />
          <span>Collapse tool calls</span>
        </button>
      )}

      {/* Show collapsed older tools if any */}
      {hasMany && !showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="px-3 py-1.5 text-xs bg-muted/50 rounded-lg hover:bg-muted transition-colors cursor-pointer w-full text-left text-muted-foreground"
        >
          <span className="flex items-center gap-1"><ChevronRight size={12} /> Show {hiddenCount} earlier tool call{hiddenCount > 1 ? 's' : ''}</span>
        </button>
      )}

      {visibleToolCalls.map((tc) => (
        <ToolCallItem key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
});
