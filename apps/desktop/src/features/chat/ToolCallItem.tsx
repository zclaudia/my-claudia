import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { AnsiUp } from 'ansi_up';
import { useChatStore, type ToolCallState } from '../../stores/chatStore';
import type { ToolSemantic } from '@my-claudia/shared';
import { getToolIcon } from '../../config/icons';
import { Icon } from '../../components/ui/Icon';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, Wrench, Square, Play } from 'lucide-react';
import { CodeViewer } from '../../components/renderers/CodeViewer';
import { DiffViewer } from '../../components/renderers/DiffViewer';
import { useTerminalStore } from '../../stores/terminalStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useServerStore } from '../../stores/serverStore';
import { toolRendererRegistry } from '../../services/toolRendererRegistry';
import { useInteractionStore } from '../../stores/interactionStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { InteractionItem } from './InteractionItem';
import type { InteractionPromptMessage } from '@my-claudia/shared';

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

// Safely extract questions array from AskUserQuestion input
function extractQuestions(raw: unknown): Array<{
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect?: boolean;
  allowCustomValue?: boolean;
  customValuePlaceholder?: string;
}> {
  const normalized = normalizeToolInput(raw);
  if (Array.isArray(normalized)) return normalized;
  if (typeof normalized === 'object' && normalized !== null) return [normalized as any];
  return [];
}

function extractInteractionId(result: unknown): string | null {
  const normalized = normalizeToolInput(result);
  if (!normalized || typeof normalized !== 'object') return null;
  const interactionId = (normalized as Record<string, unknown>).interactionId;
  return typeof interactionId === 'string' && interactionId ? interactionId : null;
}

function buildAskUserQuestionInteraction(params: {
  interactionId: string;
  sessionId: string;
  questions: ReturnType<typeof extractQuestions>;
}): InteractionPromptMessage {
  return {
    type: 'interaction_prompt',
    interactionId: params.interactionId,
    sessionId: params.sessionId,
    source: 'provider_native',
    createdAt: Date.now(),
    title: params.questions.length > 1 ? 'Questions' : 'Question',
    fields: params.questions.map((question, index) => ({
      id: `question_${index}`,
      label: question.question,
      description: question.header,
      type: question.multiSelect ? 'multiselect' : 'select',
      options: (question.options || []).map((option) => ({
        value: option.label,
        label: option.label,
        description: option.description,
      })),
      placeholder: 'Type your answer...',
      allowCustomValue: question.allowCustomValue ?? true,
      customValuePlaceholder: question.customValuePlaceholder || 'Other',
    })),
    submitLabel: 'Submit',
    cancelLabel: 'Skip',
    responseMode: 'prompt_answer',
    variant: 'question',
  };
}

function hasInteractionToolSuffix(toolName: string, suffix: string): boolean {
  return toolName === suffix
    || toolName.endsWith(`_${suffix}`)
    || toolName.endsWith(`-${suffix}`)
    || toolName.endsWith(`:${suffix}`);
}

function normalizeToolName(toolName: string): string {
  return toolName.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Check if tool is a todo-list tool (built-in TodoWrite or MCP update_todo_list)
function isTodoTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return toolName === 'TodoWrite'
    || hasInteractionToolSuffix(toolName, 'update_todo_list')
    || normalized === 'updatetodos'
    || normalized === 'todolist'
    || normalized === 'todolistwrite';
}

// Check if tool is an ask_user_form tool (MCP)
function isAskUserFormTool(toolName: string): boolean {
  return hasInteractionToolSuffix(toolName, 'ask_user_form');
}

// Check if tool is a request_approval tool (MCP)
function isApprovalTool(toolName: string): boolean {
  return hasInteractionToolSuffix(toolName, 'request_approval');
}

function isAskUserQuestionTool(toolName: string): boolean {
  return toolName === 'AskUserQuestion';
}

// Check if tool is a push_file tool (MCP)
function isPushFileTool(toolName: string): boolean {
  return hasInteractionToolSuffix(toolName, 'push_file');
}

// Whether a tool participates in plan-mode UX. The provider SDK is the source
// of truth — it tags its native plan tools with `toolSemantic`. We fall back to
// MCP-bridge suffix detection for providers that don't speak the semantic yet
// (i.e. the `claudia-plugins` enter/exit_plan_mode bridge).
function isPlanModeTool(toolName: string, semantic?: ToolSemantic): boolean {
  if (semantic === 'plan_enter' || semantic === 'plan_exit' || semantic === 'plan_proposal') {
    return true;
  }
  return hasInteractionToolSuffix(toolName, 'enter_plan_mode')
    || hasInteractionToolSuffix(toolName, 'exit_plan_mode');
}

// Whether a tool carries a plan proposal that should be rendered as a plan
// card. Driven by the shared `toolSemantic` so the UI does not need to know
// provider-specific names like `ExitPlanMode` or `createPlan`.
function isPlanProposalTool(toolName: string, semantic?: ToolSemantic): boolean {
  if (semantic === 'plan_proposal') return true;
  return hasInteractionToolSuffix(toolName, 'exit_plan_mode');
}

// Check if tool is any MCP interaction tool
function isInteractionTool(toolName: string, semantic?: ToolSemantic): boolean {
  return isTodoTool(toolName)
    || isAskUserFormTool(toolName)
    || isAskUserQuestionTool(toolName)
    || isApprovalTool(toolName)
    || isPushFileTool(toolName)
    || isPlanModeTool(toolName, semantic);
}

type TodoItem = {
  content: string;
  status: string;
};

function normalizeTodoItems(value: unknown): TodoItem[] {
  const normalized = normalizeToolInput(value);

  if (Array.isArray(normalized)) {
    return normalized.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const content = 'content' in item ? String(item.content ?? '') : '';
      if (!content) return [];
      const status = 'status' in item ? String(item.status ?? 'pending') : 'pending';
      return [{ content, status }];
    });
  }

  if (normalized && typeof normalized === 'object') {
    const record = normalized as Record<string, unknown>;
    if (Array.isArray(record.todos)) return normalizeTodoItems(record.todos);
    if (Array.isArray(record.items)) return normalizeTodoItems(record.items);
    if (Array.isArray(record.list)) return normalizeTodoItems(record.list);
    if ('content' in record) {
      const content = String(record.content ?? '');
      if (!content) return [];
      return [{ content, status: String(record.status ?? 'pending') }];
    }
  }

  return [];
}

// Format tool input for display
function formatToolInput(toolName: string, input: unknown, semantic?: ToolSemantic): string {
  input = normalizeToolInput(input);
  if (!input || typeof input !== 'object') {
    return JSON.stringify(input, null, 2);
  }

  const obj = input as Record<string, unknown>;

  // Handle MCP interaction tools before switch
  if (isTodoTool(toolName)) {
    return 'Update task list';
  }
  if (isAskUserFormTool(toolName)) {
    return obj.title as string || 'Form';
  }
  if (isApprovalTool(toolName)) {
    return obj.title as string || 'Approval required';
  }
  if (isPushFileTool(toolName)) {
    const filePath = obj.filePath as string || '';
    return filePath ? filePath.split('/').pop()! : 'Push file';
  }

  // Plan-mode tools (semantic-driven, provider-agnostic).
  if (semantic === 'plan_enter') return 'Entering plan mode';
  if (semantic === 'plan_exit') return 'Exiting plan mode';
  if (isPlanProposalTool(toolName, semantic)) {
    let planText = '';
    if (obj.plan) {
      planText = typeof obj.plan === 'string' ? obj.plan : JSON.stringify(obj.plan);
    } else if (obj.plan_file && typeof obj.plan_file === 'string') {
      planText = obj.plan_file as string;
    } else if (Object.keys(obj).length > 0) {
      planText = JSON.stringify(obj);
    }
    const firstLine = planText.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') || 'Plan ready for review';
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
  }

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
      const questions = extractQuestions(obj.questions);
      return `${questions.length} question${questions.length !== 1 ? 's' : ''}`;
    }
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
        const { selectedSessionId } = useSelectionStore.getState();
        const { sessions } = useProjectStore.getState();
        const session = sessions.find(s => s.id === selectedSessionId);
        if (!session?.projectId) return;

        const store = useTerminalStore.getState();
        if (!store.getTerminalId(session.projectId)) {
          store.openTerminal(session.projectId);
        }
        store.setDrawerOpen(session.projectId, true);
        useBottomPanelStore.getState().setActiveTab('terminal');

        const terminalId = useTerminalStore.getState().getTerminalId(session.projectId);
        if (terminalId) {
          await useTerminalStore.getState().waitForReady(terminalId);
          sendMessage({ type: 'terminal_input', terminalId, data: command });
        }
      }}
      className="absolute top-1 right-1 p-1 rounded-md opacity-0 group-hover/cmd:opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground transition-opacity"
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

// Default follow-up text inserted into the chat input when the user clicks
// "Execute plan". Kept short and editable — the input is focused so the user
// can tweak it before sending.
const EXECUTE_PLAN_PREFILL = 'Proceed with the plan above.';

// Inline "Execute plan" action shown under a non-blocking plan proposal
// (cursor's `createPlan`). Hidden for the Claude / MCP flows because by the
// time the tool reaches `completed`, the runtime has already transitioned the
// session out of plan mode — so the mode filter naturally excludes them.
function PlanProposalActions({ status }: { status: ToolCallState['status'] }) {
  const sessionId = useSelectionStore((s) => s.selectedSessionId);
  const sessionMode = useChatStore((s) =>
    sessionId ? s.modeOverrides[sessionId] || s.runtimeModes[sessionId] || '' : '',
  );
  const setMode = useChatStore((s) => s.setMode);
  const setPendingPrefill = useChatStore((s) => s.setPendingPrefill);

  if (!sessionId) return null;
  if (status !== 'completed') return null;
  if (sessionMode !== 'plan') return null;

  const handleExecute = () => {
    setMode(sessionId, 'default');
    setPendingPrefill(sessionId, EXECUTE_PLAN_PREFILL);
  };

  return (
    <div className="mt-2 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={handleExecute}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
      >
        <Play size={11} strokeWidth={2.2} />
        Execute plan
      </button>
    </div>
  );
}

// Render expanded content based on tool type
function ToolExpandedContent({ toolName, toolInput, status, result, isError, semantic }: {
  toolName: string;
  toolInput: unknown;
  status: ToolCallState['status'];
  result?: unknown;
  isError?: boolean;
  semantic?: ToolSemantic;
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
              className="text-xs rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre bg-destructive/20 text-destructive"
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
              className="text-xs rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre bg-destructive/20 text-destructive"
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

  // AskUserQuestion: readonly rendering; interactive answering is unified via InteractionItem
  if (toolName === 'AskUserQuestion' && input?.questions) {
    const questions = extractQuestions(input.questions);

    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2 space-y-3">
          {questions.map((q, idx) => (
            <div key={idx}>
              <div className="flex items-start gap-2 mb-1.5">
                <span className="inline-block px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded-md font-medium flex-shrink-0">
                  {q.header}
                </span>
                <span className="text-xs text-foreground">{q.question}</span>
              </div>
              <div className="ml-2 space-y-1">
                {(Array.isArray(q.options) ? q.options : []).map((opt) => (
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
                {(q.allowCustomValue ?? true) && (
                  <div className="flex items-start gap-2 text-xs">
                    <span className="text-muted-foreground flex-shrink-0">{q.multiSelect ? '☐' : '○'}</span>
                    <div>
                      <span className="text-foreground">{q.customValuePlaceholder || 'Other'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Show user's answer (comes as the deny message) */}
        {result !== undefined && (
          <div className="mt-3">
            <div className="text-xs text-muted-foreground mb-1">User's Answer:</div>
            <pre className="text-xs bg-primary/10 rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre text-foreground">
              {formatToolResult(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Plan proposal: show plan content formatted. Driven by the shared
  // `toolSemantic` so this works for Claude's ExitPlanMode, Codex's MCP
  // exit_plan_mode, Cursor's createPlan, and any future provider that tags
  // its plan tool with `plan_proposal`.
  if (isPlanProposalTool(toolName, semantic)) {
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
        <PlanProposalActions status={status} />
        {status !== 'running' && result !== undefined && (
          <div className="mt-2">
            <pre
              data-testid="tool-result"
              className={`text-xs rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre ${
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

  // TodoWrite / MCP update_todo_list: show task list
  if (isTodoTool(toolName)) {
    const todoSource = input?.todos || input;
    const todos = normalizeTodoItems(todoSource);
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2 space-y-1">
          {todos.length === 0 && (
            <div className="text-xs text-muted-foreground">Task list unavailable</div>
          )}
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

  // MCP ask_user_form: show form fields summary
  if (isAskUserFormTool(toolName) && input) {
    const title = input.title as string || 'Form';
    const description = input.description as string | undefined;
    const fields = (input.fields as Array<{ id: string; label: string; type: string; required?: boolean }>) || [];
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2">
          <div className="text-xs font-medium text-foreground mb-1">{title}</div>
          {description && <div className="text-xs text-muted-foreground mb-2">{description}</div>}
          <div className="space-y-1">
            {fields.map((field, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">{field.type === 'confirm' ? '☐' : '•'}</span>
                <span className="text-foreground">{field.label}</span>
                {field.required && <span className="text-destructive text-[10px]">*</span>}
                <span className="text-muted-foreground text-[10px]">({field.type})</span>
              </div>
            ))}
          </div>
        </div>
        {status !== 'running' && result !== undefined && (
          <div className="mt-2">
            <div className="text-xs text-muted-foreground mb-1">Response:</div>
            <pre className={`text-xs rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre ${isError ? 'bg-destructive/20 text-destructive' : 'bg-primary/10 text-foreground'}`}>
              {formatToolResult(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // MCP request_approval: show approval details
  if (isApprovalTool(toolName) && input) {
    const title = input.title as string || 'Approval Required';
    const message = input.message as string || '';
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2">
          <div className="text-xs font-medium text-foreground mb-1">{title}</div>
          {message && <div className="text-xs text-muted-foreground whitespace-pre-wrap">{message}</div>}
        </div>
        {status !== 'running' && result !== undefined && (
          <div className="mt-2">
            <pre className={`text-xs rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre ${isError ? 'bg-destructive/20 text-destructive' : 'bg-primary/10 text-foreground'}`}>
              {formatToolResult(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // MCP push_file: show file info
  if (isPushFileTool(toolName) && input) {
    const filePath = input.filePath as string || '';
    const description = input.description as string | undefined;
    return (
      <div className="px-3 pb-3 border-t border-border/50">
        <div className="mt-2">
          {filePath && <div className="text-xs font-mono text-foreground">{filePath}</div>}
          {description && <div className="text-xs text-muted-foreground mt-1">{description}</div>}
        </div>
        {status !== 'running' && result !== undefined && (
          <div className="mt-2">
            <pre className={`text-xs rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] whitespace-pre ${isError ? 'bg-destructive/20 text-destructive' : 'bg-primary/10 text-foreground'}`}>
              {formatToolResult(result)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // Default: generic JSON input + result
  return (
    <div className="px-3 pb-3 border-t border-border/50">
      {/* Input */}
      <div className="mt-2">
        <div className="text-xs text-muted-foreground mb-1">Input:</div>
        <pre className="text-xs bg-muted/50 rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] text-foreground whitespace-pre">
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
            className={`text-xs rounded-md p-2 overflow-x-auto touch-pan-x [-webkit-overflow-scrolling:touch] max-h-96 overflow-y-auto whitespace-pre ${
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
  // Plan proposals auto-expand on completion so the plan body and the
  // "Execute plan" button are visible without an extra click. The state is
  // user-toggleable afterwards; `autoExpandedRef` ensures we only auto-expand
  // once per tool call (so user collapses stick).
  const [isExpanded, setIsExpanded] = useState(() =>
    isPlanProposalTool(toolCall.toolName, toolCall.semantic) && toolCall.status === 'completed',
  );
  const autoExpandedRef = useRef(
    isPlanProposalTool(toolCall.toolName, toolCall.semantic) && toolCall.status === 'completed',
  );
  useEffect(() => {
    if (autoExpandedRef.current) return;
    if (!isPlanProposalTool(toolCall.toolName, toolCall.semantic)) return;
    if (toolCall.status !== 'completed') return;
    autoExpandedRef.current = true;
    setIsExpanded(true);
  }, [toolCall.status, toolCall.toolName, toolCall.semantic]);
  const { toolName, toolInput, status, result, isError, activity, semantic } = toolCall;
  const selectedSessionId = useSelectionStore((s) => s.selectedSessionId);
  const pendingPromptRequest = usePromptRequestStore((s) => {
    if (!selectedSessionId || toolName !== 'AskUserQuestion') return null;
    for (let i = s.pendingRequests.length - 1; i >= 0; i--) {
      if (s.pendingRequests[i].sessionId === selectedSessionId) return s.pendingRequests[i];
    }
    return null;
  });
  const fallbackPromptInteraction = useMemo(() => {
    if (!selectedSessionId || !pendingPromptRequest || toolName !== 'AskUserQuestion') return null;
    const normalizedInput = normalizeToolInput(toolInput) as Record<string, unknown> | undefined;
    const questions = extractQuestions(normalizedInput?.questions);
    if (questions.length === 0) return null;
    return buildAskUserQuestionInteraction({
      interactionId: pendingPromptRequest.requestId,
      sessionId: selectedSessionId,
      questions,
    });
  }, [pendingPromptRequest, selectedSessionId, toolInput, toolName]);

  // Phase 1 dedup: render InteractionItem instead of interaction tool when interaction store has it
  const interactionId = extractInteractionId(result);
  const interaction = useInteractionStore((s) => {
    const direct = s.interactions[toolCall.id] || (interactionId ? s.interactions[interactionId] : undefined);
    if (direct) return direct;

    // A plan-proposal tool creates a separate interaction before the tool
    // result exists. We match on the shared semantic (plus the MCP bridge
    // suffix fallback) instead of provider-specific tool names.
    if (selectedSessionId && status === 'running' && isPlanProposalTool(toolName, semantic)) {
      return Object.values(s.interactions)
        .filter((item) => item.sessionId === selectedSessionId && item.type === 'interaction_plan_review')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    if (selectedSessionId && status === 'running' && toolName === 'AskUserQuestion') {
      return Object.values(s.interactions)
        .filter((item) =>
          item.sessionId === selectedSessionId
          && item.type === 'interaction_prompt'
          && item.source === 'provider_native'
          && item.variant === 'question',
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    return undefined;
  });
  const resolvedInteraction = interaction ?? fallbackPromptInteraction;
  if (resolvedInteraction && isInteractionTool(toolName, semantic)) {
    if (resolvedInteraction.type === 'interaction_todo_update' && resolvedInteraction.todos.length > 0) {
      return <InteractionItem interaction={resolvedInteraction} />;
    }
    if (resolvedInteraction.type === 'interaction_prompt' || resolvedInteraction.type === 'interaction_approval' || resolvedInteraction.type === 'interaction_plan_review') {
      return <InteractionItem interaction={resolvedInteraction} />;
    }
  }

  const icon = getToolIcon(toolName);
  const displayName = isTodoTool(toolName) ? 'TodoWrite'
    : isAskUserFormTool(toolName) ? 'AskUserForm'
    : isApprovalTool(toolName) ? 'RequestApproval'
    : isPushFileTool(toolName) ? 'PushFile'
    : toolName;
  const summary = formatToolInput(toolName, toolInput, semantic);

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
        <span className="text-xs font-medium text-foreground" data-testid="tool-name">{displayName}</span>

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
          semantic={semantic}
        />
      )}
    </div>
  );
});

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

/**
 * Interactive inline answer UI for AskUserQuestion tool calls.
 * Rendered when the tool call is still running (status='running'),
 * allowing the user to answer directly from the tool call card
 * — works on both desktop and mobile/gateway clients.
 */
