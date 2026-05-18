import { AnsiUp } from 'ansi_up';
import type { ToolSemantic, InteractionPromptMessage } from '@my-claudia/shared';
import {
  isTodoTool,
  isAskUserFormTool,
  isApprovalTool,
  isPushFileTool,
  isPlanProposalTool,
} from './toolClassifiers';

const ansiUp = new AnsiUp();

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

export {
  ansiUp,
  normalizeToolInput,
  extractQuestions,
  extractInteractionId,
  buildAskUserQuestionInteraction,
  normalizeTodoItems,
  formatToolInput,
  formatToolResult,
  ansiToHtml,
};
export type { TodoItem };
