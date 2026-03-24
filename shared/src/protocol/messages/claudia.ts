// Claudia Task protocol messages

export type ClaudiaTaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type BranchAction = 'reused' | 'forked' | 'created';

// Client → Server: submit a new Claudia task
export interface ClaudiaTaskSubmitMessage {
  type: 'claudia_task_submit';
  clientRequestId: string;
  sessionId: string;     // Claudia hub session
  input: string;
  projectId: string;
  providerId?: string;
  activeBranchId?: string;
  forceNewBranch?: boolean;
}

// Client → Server: continue an existing task
export interface ClaudiaTaskContinueMessage {
  type: 'claudia_task_continue';
  clientRequestId: string;
  taskId: string;          // Original task ID
  sessionId: string;       // Original task's backend session
  input: string;           // Follow-up instruction
}

// Client → Server: cancel an existing Claudia task
export interface ClaudiaTaskCancelMessage {
  type: 'claudia_task_cancel';
  taskId: string;
}

// Server → Client: task created confirmation
export interface ClaudiaTaskCreatedMessage {
  type: 'claudia_task_created';
  clientRequestId: string;
  taskId: string;
  projectId: string;
  sessionId: string;       // Backend task session
  branchId: string;        // Branch this task belongs to
  branchAction: BranchAction; // Whether branch was reused/forked/created
  title: string;
  status: 'queued';
  contextReset?: boolean;  // True if session resume failed (context lost)
}

export interface ClaudiaTaskSnapshotTask {
  id: string;
  sessionId: string | null;
  branchId: string | null;
  branchAction?: BranchAction;
  contextReset?: boolean;
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  responseText?: string;
  toolCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ClaudiaActiveBranchState {
  projectId: string;
  branchId: string;
}

// Server → Client: full/partial Claudia task snapshot for state recovery
export interface ClaudiaTaskSnapshotMessage {
  type: 'claudia_task_snapshot';
  tasks: ClaudiaTaskSnapshotTask[];
  activeBranches: ClaudiaActiveBranchState[];
}

// Server → Client: task status update
export interface ClaudiaTaskUpdateMessage {
  type: 'claudia_task_update';
  taskId: string;
  status: ClaudiaTaskStatus;
  sessionId?: string;
  branchId?: string;
  branchAction?: BranchAction;
  contextReset?: boolean;
  input?: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  summary?: string;
  error?: string;
  responseText?: string;   // Full assistant response (on completion)
  toolCount?: number;      // Number of tool calls made
}

// Server → Client: streaming text for a running task
export interface ClaudiaTaskDeltaMessage {
  type: 'claudia_task_delta';
  taskId: string;
  content: string;
}

// Client → Server: send a message to Claudia (inline first, may promote to task)
export interface ClaudiaMessageMessage {
  type: 'claudia_message';
  clientRequestId: string;
  input: string;
  projectId: string;
  contextProjectIds?: string[];
  primaryContextProjectId?: string;
  providerId?: string;
  activeBranchId?: string;  // Current active branch for reuse/fork decision
  forceNewBranch?: boolean; // Force create new branch (new conversation)
}

// Server → Client: streaming text for inline response
export interface ClaudiaMessageDeltaMessage {
  type: 'claudia_message_delta';
  clientRequestId: string;
  content: string;
}

// Server → Client: inline response completed (no tool use, fast)
export interface ClaudiaMessageCompletedMessage {
  type: 'claudia_message_completed';
  clientRequestId: string;
  responseText: string;
}

// Server → Client: inline response failed before promotion
export interface ClaudiaMessageFailedMessage {
  type: 'claudia_message_failed';
  clientRequestId: string;
  error: string;
}

// Server → Client: inline response promoted to background task
export interface ClaudiaMessagePromotedMessage {
  type: 'claudia_message_promoted';
  clientRequestId: string;
  taskId: string;
  projectId: string;
  sessionId: string;
  branchId: string;
  branchAction: BranchAction;
  contextReset?: boolean;
}
