import { CheckCircle2, Loader2, Square } from 'lucide-react';
import type { ToolSemantic } from '@my-claudia/shared';
import { type ToolCallState } from '../../../stores/chatStore';
import { CodeViewer } from '../../../components/renderers/CodeViewer';
import { DiffViewer } from '../../../components/renderers/DiffViewer';
import { toolRendererRegistry } from '../../../services/toolRendererRegistry';
import {
  isTodoTool,
  isAskUserFormTool,
  isApprovalTool,
  isPushFileTool,
  isPlanProposalTool,
} from './toolClassifiers';
import {
  normalizeToolInput,
  extractQuestions,
  normalizeTodoItems,
  formatToolResult,
} from './toolFormatters';
import { TerminalOutput, RunInTerminalButton } from './TerminalOutput';
import { PlanContent, PlanProposalActions } from './PlanContent';

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

export { ToolExpandedContent };
