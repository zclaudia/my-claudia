export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result: TResult;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcError;

export interface ACPInitializeResult {
  protocolVersion?: number;
  agentCapabilities?: {
    loadSession?: boolean;
    sessionCapabilities?: {
      resume?: unknown;
      close?: unknown;
    };
    mcpCapabilities?: {
      http?: boolean;
      sse?: boolean;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ACPSessionNewResult {
  sessionId: string;
}

export interface ACPPromptResult {
  stopReason?: string;
  [key: string]: unknown;
}

export interface ACPMcpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
}

export interface ACPSessionParams {
  sessionId?: string;
  cwd: string;
  mcpServers?: ACPMcpServer[];
}

export interface ACPContentBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface ACPToolCall {
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  content?: ACPToolCallContent[];
  locations?: Array<{ path: string; line?: number }>;
  rawInput?: unknown;
  rawOutput?: unknown;
  [key: string]: unknown;
}

export type ACPToolCallContent =
  | { type: 'content'; content?: ACPContentBlock }
  | { type: 'diff'; path?: string; oldText?: string | null; newText?: string | null }
  | { type: 'terminal'; terminalId?: string }
  | Record<string, unknown>;

export interface ACPSessionUpdate {
  sessionUpdate?: string;
  content?: ACPContentBlock | ACPToolCallContent[];
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  contentBlocks?: ACPToolCallContent[];
  contentItems?: ACPToolCallContent[];
  contentParts?: ACPToolCallContent[];
  contentList?: ACPToolCallContent[];
  contentUpdates?: ACPToolCallContent[];
  contentUpdate?: ACPToolCallContent[];
  contentDelta?: ACPToolCallContent[];
  locations?: Array<{ path: string; line?: number }>;
  plan?: string;
  mode?: string;
  [key: string]: unknown;
}

export interface ACPSessionUpdateParams {
  sessionId?: string;
  update?: ACPSessionUpdate;
}

export interface ACPPermissionOption {
  optionId: string;
  name?: string;
  kind?: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}

export interface ACPPermissionRequestParams {
  sessionId?: string;
  toolCall?: ACPToolCall;
  options?: ACPPermissionOption[];
}
