// Unified Interaction Types

// AskUserQuestion types
export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
  allowCustomValue?: boolean;
  customValuePlaceholder?: string;
  placeholder?: string;
}

// Unified Interaction Events

/** How the interaction was detected */
export type InteractionSource = 'provider_native' | 'tool_call' | 'text_inferred';

/** Base fields shared by all interaction events */
export interface InteractionBase {
  interactionId: string;   // Reuses requestId or toolUseId
  sessionId: string;
  runId?: string;
  provider?: string;       // e.g. 'claude', 'opencode', 'codex'
  source: InteractionSource;
  createdAt: number;
}

/** Unified ask-user interaction */
export interface InteractionPromptOption {
  value: string;
  label: string;
  description?: string;
}

export interface InteractionPromptField {
  id: string;
  label: string;
  description?: string;
  type: 'text' | 'select' | 'multiselect' | 'textarea' | 'confirm';
  options?: InteractionPromptOption[];
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  allowCustomValue?: boolean;
  customValuePlaceholder?: string;
}

export interface InteractionPromptMessage extends InteractionBase {
  type: 'interaction_prompt';
  title: string;
  description?: string;
  fields: InteractionPromptField[];
  submitLabel?: string;
  cancelLabel?: string;
  responseMode?: 'interaction_response' | 'prompt_answer';
  variant?: 'question' | 'form';
}

/** Normalized todo item for interaction layer */
export interface NormalizedTodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Unified todo-update interaction */
export interface TodoUpdateInteractionMessage extends InteractionBase {
  type: 'interaction_todo_update';
  todos: NormalizedTodoItem[];
}

/** Resolution event for any interaction */
export interface InteractionResolvedMessage {
  type: 'interaction_resolved';
  interactionId: string;
  sessionId?: string;
}

export type AskUserFormField = InteractionPromptField;

/** Approval request interaction (from internal request_approval tool) */
export interface ApprovalInteractionMessage extends InteractionBase {
  type: 'interaction_approval';
  title: string;
  message: string;
  approveLabel?: string;
  rejectLabel?: string;
  payload?: Record<string, unknown>;
}

/** Plan review interaction (from exit_plan_mode tool) */
export interface PlanReviewInteractionMessage extends InteractionBase {
  type: 'interaction_plan_review';
  plan: string;
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
}

/** Client → Server: user submitted a form response */
export interface InteractionResponseMessage {
  type: 'interaction_response';
  interactionId: string;
  sessionId?: string;
  response: Record<string, unknown>;
}

/** Union of all interaction message types */
export type InteractionMessage = InteractionPromptMessage | TodoUpdateInteractionMessage | ApprovalInteractionMessage | PlanReviewInteractionMessage;
