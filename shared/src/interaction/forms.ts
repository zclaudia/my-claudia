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
export interface AskUserInteractionMessage extends InteractionBase {
  type: 'interaction_ask_user';
  questions: AskUserQuestionItem[];
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

/** Form field definition for ask_user_form */
export interface AskUserFormField {
  id: string;
  label: string;
  type: 'text' | 'select' | 'multiselect' | 'textarea' | 'confirm';
  options?: { value: string; label: string }[];
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
}

/** Structured form interaction (from internal ask_user_form tool) */
export interface AskUserFormInteractionMessage extends InteractionBase {
  type: 'interaction_ask_user_form';
  title: string;
  description?: string;
  fields: AskUserFormField[];
}

/** Approval request interaction (from internal request_approval tool) */
export interface ApprovalInteractionMessage extends InteractionBase {
  type: 'interaction_approval';
  title: string;
  message: string;
  approveLabel?: string;
  rejectLabel?: string;
  payload?: Record<string, unknown>;
}

/** Client → Server: user submitted a form response */
export interface InteractionResponseMessage {
  type: 'interaction_response';
  interactionId: string;
  sessionId?: string;
  response: Record<string, unknown>;
}

/** Union of all interaction message types */
export type InteractionMessage = AskUserInteractionMessage | TodoUpdateInteractionMessage | AskUserFormInteractionMessage | ApprovalInteractionMessage;
