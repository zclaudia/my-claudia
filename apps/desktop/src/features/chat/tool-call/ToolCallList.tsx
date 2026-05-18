import { useState, useEffect, useRef, memo } from 'react';
import { type ToolCallState } from '../../../stores/chatStore';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import {
  isTodoTool,
  isAskUserFormTool,
  isApprovalTool,
  isPushFileTool,
  isPlanProposalTool,
} from './toolClassifiers';
import { normalizeToolInput, formatToolInput } from './toolFormatters';
import { ToolCallItem } from '../ToolCallItem';

interface ToolCallListProps {
  toolCalls: ToolCallState[];
  defaultCollapsed?: boolean;
  isStreaming?: boolean;
}

// Get a short summary of what a tool call did
function getToolCallSummary(tc: ToolCallState): string {
  const input = normalizeToolInput(tc.toolInput) as Record<string, unknown> | undefined;
  if (!input) return tc.toolName;

  // Handle MCP interaction tools before switch
  if (isTodoTool(tc.toolName)) {
    return 'Update todos';
  }
  if (isAskUserFormTool(tc.toolName)) {
    return String(input.title || 'Form').substring(0, 20);
  }
  if (isApprovalTool(tc.toolName)) {
    return String(input.title || 'Approval').substring(0, 20);
  }
  if (isPushFileTool(tc.toolName)) {
    const fp = String(input.filePath || '');
    return fp ? fp.split('/').pop()! : 'Push file';
  }

  // Plan-mode tools: semantic-driven so we don't hardcode provider tool names.
  if (tc.semantic === 'plan_enter') return 'Enter plan mode';
  if (tc.semantic === 'plan_exit') return 'Exit plan mode';
  if (isPlanProposalTool(tc.toolName, tc.semantic)) {
    let planText = '';
    if (input.plan) {
      planText = typeof input.plan === 'string' ? input.plan : JSON.stringify(input.plan);
    } else if (input.plan_file && typeof input.plan_file === 'string') {
      planText = input.plan_file;
    } else if (Object.keys(input).length > 0) {
      planText = JSON.stringify(input);
    }
    const title = planText.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') || 'Plan';
    return title.substring(0, 25);
  }

  switch (tc.toolName) {
    case 'Read':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Read';
    case 'Write':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Write';
    case 'Edit':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Edit';
    case 'Bash': {
      const cmd = String(input.command || '').split(' ')[0];
      return cmd || 'bash';
    }
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
    case 'AskUserQuestion': {
      const questions = (input.questions as Array<{ header: string }>) || [];
      return questions[0]?.header || 'question';
    }
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

function getToolCallDisplayStatus(tc: ToolCallState): ToolCallState['status'] {
  // AskUserQuestion reports normal user answers through the provider's error path.
  // Match ToolCallItem's non-destructive rendering in collapsed summaries.
  if (tc.toolName === 'AskUserQuestion' && tc.status === 'error') {
    return 'completed';
  }
  return tc.status;
}

const MAX_VISIBLE_TOOLS = 5;

function SummaryBar({ toolCalls, onClick }: { toolCalls: ToolCallState[]; onClick: () => void }) {
  const completedCount = toolCalls.filter((tc) => getToolCallDisplayStatus(tc) === 'completed').length;
  const errorCount = toolCalls.filter((tc) => getToolCallDisplayStatus(tc) === 'error').length;
  const runningCount = toolCalls.filter((tc) => getToolCallDisplayStatus(tc) === 'running').length;

  return (
    <div
      onClick={onClick}
      className="px-3 py-2 text-xs bg-muted/50 rounded-md hover:bg-muted transition-colors cursor-pointer"
    >
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
      <div className="flex flex-wrap gap-1.5">
        {toolCalls.map((tc, idx) => {
          const displayStatus = getToolCallDisplayStatus(tc);
          return (
            <span
              key={tc.id || idx}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] ${
                displayStatus === 'error'
                  ? 'bg-destructive/20 text-destructive'
                  : displayStatus === 'running'
                  ? 'bg-primary/20 text-primary'
                  : 'bg-secondary text-muted-foreground'
              }`}
              title={formatToolInput(tc.toolName, tc.toolInput)}
            >
              <span>{getStatusIconComponent(displayStatus)}</span>
              <span className="truncate max-w-[120px]">{getToolCallSummary(tc)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

type ToolCallListMode = 'streaming' | 'collapsed' | 'expanded';

export const ToolCallList = memo(function ToolCallList({ toolCalls, defaultCollapsed = false, isStreaming = false }: ToolCallListProps) {
  const [userOverride, setUserOverride] = useState<ToolCallListMode | null>(null);
  const [showAll, setShowAll] = useState(false);

  // While streaming, a new tool arriving should reset any user override so the latest tool
  // becomes visible again; otherwise a single click could hide every subsequent tool of the run.
  const prevLengthRef = useRef(toolCalls.length);
  useEffect(() => {
    if (isStreaming && toolCalls.length !== prevLengthRef.current) {
      setUserOverride(null);
      setShowAll(false);
    }
    prevLengthRef.current = toolCalls.length;
  }, [toolCalls.length, isStreaming]);

  if (toolCalls.length === 0) return null;

  const defaultMode: ToolCallListMode = defaultCollapsed ? 'collapsed' : isStreaming ? 'streaming' : 'expanded';
  const mode: ToolCallListMode = userOverride ?? defaultMode;

  if (mode === 'collapsed') {
    return <SummaryBar toolCalls={toolCalls} onClick={() => setUserOverride('expanded')} />;
  }

  if (mode === 'streaming') {
    // Expand only the currently-running tools; everything else folds into the summary bar above.
    // If none are running, fall back to the latest one for visual continuity during the brief gap
    // between a tool finishing and the next one starting.
    const runningTools: ToolCallState[] = [];
    const otherTools: ToolCallState[] = [];
    for (const tc of toolCalls) {
      if (tc.status === 'running') runningTools.push(tc);
      else otherTools.push(tc);
    }
    const hasRunning = runningTools.length > 0;
    const expandedTools = hasRunning ? runningTools : [toolCalls[toolCalls.length - 1]];
    const olderTools = hasRunning ? otherTools : toolCalls.slice(0, -1);
    return (
      <div className="space-y-2">
        {olderTools.length > 0 && (
          <SummaryBar toolCalls={olderTools} onClick={() => setUserOverride('expanded')} />
        )}
        {expandedTools.map((tc) => (
          <ToolCallItem key={tc.id} toolCall={tc} />
        ))}
      </div>
    );
  }

  const hasMany = toolCalls.length > MAX_VISIBLE_TOOLS;
  const earlierCount = Math.max(0, toolCalls.length - MAX_VISIBLE_TOOLS);
  const visibleToolCalls = !hasMany || showAll
    ? toolCalls
    : toolCalls.slice(-MAX_VISIBLE_TOOLS);

  const collapseAll = () => {
    setUserOverride('collapsed');
    setShowAll(false);
  };

  return (
    <div className="space-y-1">
      <button
        onClick={collapseAll}
        className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown size={12} />
        <span>Collapse tool calls</span>
      </button>

      {hasMany && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="px-3 py-1.5 text-xs bg-muted/50 rounded-md hover:bg-muted transition-colors cursor-pointer w-full text-left text-muted-foreground"
        >
          <span className="flex items-center gap-1">
            {showAll ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {showAll ? 'Hide' : 'Show'} {earlierCount} earlier tool call{earlierCount > 1 ? 's' : ''}
          </span>
        </button>
      )}

      {visibleToolCalls.map((tc) => (
        <ToolCallItem key={tc.id} toolCall={tc} />
      ))}
    </div>
  );
});

export type { ToolCallListProps, ToolCallListMode };
export { SummaryBar, getToolCallSummary, getStatusIconComponent, getToolCallDisplayStatus, MAX_VISIBLE_TOOLS };
