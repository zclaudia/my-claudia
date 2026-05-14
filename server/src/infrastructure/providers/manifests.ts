import type { PCPProviderManifest } from '@my-claudia/shared/core/pcp';
import type { ProviderPolicy } from '@my-claudia/shared/core/provider-policy';

export const CLAUDE_CAPABILITY_MANIFEST: PCPProviderManifest = {
  id: 'claude',
  name: 'Claude',
  version: '1.0.0',
  apiVersion: 'pcp/v1',
  providerType: 'claude',
  runtime: 'cli',
  capabilities: [
    { id: 'chat.generate', supported: false, notes: 'Not implemented yet, planned for plugin API' },
    { id: 'chat.stream', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.inject', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'interaction.form', supported: true, mode: 'bridged', reliability: 'strict' },
    { id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'strict' },
    { id: 'interaction.todo', supported: true, mode: 'bridged', reliability: 'strict' },
    { id: 'input.image', supported: true, mode: 'native', reliability: 'strict',
      limits: { attachmentModes: 'temp_file,file_path' } },
    { id: 'input.text_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'input.binary_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'permission.mode', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.abort', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.background_task', supported: true, mode: 'native', reliability: 'best_effort',
      notes: 'Background tasks initiated by model, not controllable by user' },
  ],
  permissionModeMap: {
    supervised: 'default',
    auto_edit: 'acceptEdits',
    autonomous: 'bypassPermissions',
    plan_only: 'plan',
  },
};

export const CLAUDE_POLICY: ProviderPolicy = {
  // Claude has native: TodoWrite ~= update_todo_list, AskUserQuestion ~= ask_user_form/request_approval,
  // plan mode ~= enter/exit_plan_mode. Only push_file has no Claude equivalent.
  nativeInteractionTools: ['update_todo_list', 'ask_user_form', 'request_approval', 'enter_plan_mode', 'exit_plan_mode'],
  // Claude's CLI surfaces auth expiry through several phrasings; recognize all
  // of them and steer the user to `claude auth login`.
  authErrorHint: {
    matchAny: [
      'oauth token has expired',
      ['authentication_error', 'token has expired'],
      ['failed to authenticate', '401'],
    ],
    message: 'Claude authentication expired on this machine. Re-login with `claude auth login` and retry. ({raw})',
  },
  // Plan submissions need explicit user approval — declared at the provider
  // level so the shared permission policy stays free of provider-specific
  // tool names.
  escalateAlwaysTools: ['ExitPlanMode'],
};

export const CLAUDE_MANIFEST = CLAUDE_CAPABILITY_MANIFEST;

export const OPENCODE_CAPABILITY_MANIFEST: PCPProviderManifest = {
  id: 'opencode',
  name: 'OpenCode',
  version: '1.0.0',
  apiVersion: 'pcp/v1',
  providerType: 'opencode',
  runtime: 'cli',
  capabilities: [
    { id: 'chat.generate', supported: false },
    { id: 'chat.stream', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.inject', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'interaction.form', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.todo', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'input.image', supported: true, mode: 'native', reliability: 'strict',
      limits: { attachmentModes: 'data_uri' } },
    { id: 'input.text_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'input.binary_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'permission.mode', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.abort', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.background_task', supported: false },
  ],
  permissionModeMap: {
    supervised: 'default',
    autonomous: 'yolo',
    plan_only: 'plan',
  },
};

export const OPENCODE_POLICY: ProviderPolicy = {
  // OpenCode sometimes completes a tool-heavy turn without emitting a final
  // assistant text. The runtime treats this declarative fallback as the
  // visible reply so the conversation never ends in an empty bubble.
  emptyResultFallback: 'Task execution completed, but the provider did not return a final visible text response. Send "summarize the result" to get a structured conclusion.',
};

export const OPENCODE_MANIFEST = OPENCODE_CAPABILITY_MANIFEST;

export const CODEX_CAPABILITY_MANIFEST: PCPProviderManifest = {
  id: 'codex',
  name: 'Codex',
  version: '1.0.0',
  apiVersion: 'pcp/v1',
  providerType: 'codex',
  runtime: 'cli',
  capabilities: [
    { id: 'chat.generate', supported: false },
    { id: 'chat.stream', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'tool.inject', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'interaction.form', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.todo', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'input.image', supported: true, mode: 'native', reliability: 'strict',
      limits: { attachmentModes: 'file_path' } },
    { id: 'input.text_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'input.binary_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'permission.mode', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.abort', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.background_task', supported: false },
  ],
  permissionModeMap: {
    supervised: 'default',
    auto_edit: 'acceptEdits',
    autonomous: 'bypassPermissions',
    plan_only: 'plan',
  },
};

export const CODEX_POLICY: ProviderPolicy = {
  // Codex routes plan-mode through the MCP bridge under canonical Pascal names.
  escalateAlwaysTools: ['ExitPlanMode'],
};

export const CODEX_MANIFEST = CODEX_CAPABILITY_MANIFEST;

export const CURSOR_CAPABILITY_MANIFEST: PCPProviderManifest = {
  id: 'cursor',
  name: 'Cursor',
  version: '1.0.0',
  apiVersion: 'pcp/v1',
  providerType: 'cursor',
  runtime: 'cli',
  capabilities: [
    { id: 'chat.generate', supported: false },
    { id: 'chat.stream', supported: true, mode: 'native', reliability: 'best_effort' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'best_effort' },
    { id: 'tool.inject', supported: true, mode: 'bridged', reliability: 'best_effort',
      notes: 'Via .cursor/mcp.json injection' },
    { id: 'interaction.form', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.todo', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'input.image', supported: true, mode: 'native', reliability: 'strict',
      limits: { attachmentModes: 'file_path' } },
    { id: 'input.text_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'input.binary_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'permission.mode', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.abort', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.background_task', supported: false },
  ],
  permissionModeMap: {
    supervised: 'default',
    plan_only: 'plan',
  },
};

export const CURSOR_POLICY: ProviderPolicy = {
  // cursor-agent accepts --resume together with --mode=plan/ask, so keeping
  // the chat id is required for follow-up turns in read-only modes.
  modeSwitchSessionPolicy: 'preserve',
  // Cursor's plan-mode UX is informational (read-only enforcement happens at
  // cursor-agent itself) — no escalateAlwaysTools needed here.
};

export const CURSOR_MANIFEST = CURSOR_CAPABILITY_MANIFEST;

export const KIMI_CAPABILITY_MANIFEST: PCPProviderManifest = {
  id: 'kimi',
  name: 'Kimi',
  version: '1.0.0',
  apiVersion: 'pcp/v1',
  providerType: 'kimi',
  runtime: 'cli',
  capabilities: [
    { id: 'chat.generate', supported: false },
    { id: 'chat.stream', supported: true, mode: 'native', reliability: 'best_effort',
      notes: 'JSON-line stream; no retry on disconnect' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'best_effort' },
    { id: 'tool.inject', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.form', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.todo', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'input.image', supported: true, mode: 'native', reliability: 'best_effort',
      notes: 'Passed as file_path; model may not process all formats',
      limits: { attachmentModes: 'file_path' } },
    { id: 'input.text_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'input.binary_file', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'permission.mode', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.abort', supported: true, mode: 'native', reliability: 'strict' },
    { id: 'session.background_task', supported: false },
  ],
  permissionModeMap: {
    supervised: 'default',
    autonomous: 'yolo',
    plan_only: 'plan',
  },
};

export const KIMI_POLICY: ProviderPolicy = {
  // Kimi persists sessions under a work-dir-scoped storage tree — resuming
  // with a different cwd silently creates a fresh empty session, so any
  // resumed run must stay pinned to the original session root.
  sessionCwdPolicy: 'pinned',
};

export const KIMI_MANIFEST = KIMI_CAPABILITY_MANIFEST;

export const ACP_CAPABILITY_MANIFEST: PCPProviderManifest = {
  id: 'acp',
  name: 'ACP Agent',
  version: '0.1.0',
  apiVersion: 'pcp/v1',
  providerType: 'acp',
  runtime: 'bridge',
  capabilities: [
    { id: 'chat.generate', supported: false, notes: 'ACP prompt turns are consumed as streams in MyClaudia' },
    { id: 'chat.stream', supported: true, mode: 'native', reliability: 'best_effort',
      notes: 'Maps ACP session/update notifications into MyClaudia provider messages' },
    { id: 'tool.call', supported: true, mode: 'native', reliability: 'best_effort' },
    { id: 'tool.inject', supported: true, mode: 'native', reliability: 'best_effort',
      notes: 'ACP session setup can pass MCP server definitions to the agent' },
    { id: 'interaction.form', supported: true, mode: 'bridged', reliability: 'best_effort',
      notes: 'ACP permission requests are bridged through MyClaudia permission UI' },
    { id: 'interaction.approval', supported: true, mode: 'bridged', reliability: 'best_effort' },
    { id: 'interaction.todo', supported: false,
      notes: 'ACP does not define a canonical todo update event' },
    { id: 'input.image', supported: false,
      notes: 'Experimental adapter currently sends text prompts only' },
    { id: 'input.text_file', supported: false,
      notes: 'Client-side ACP filesystem methods are reserved for a follow-up phase' },
    { id: 'input.binary_file', supported: false,
      notes: 'Client-side ACP filesystem methods are reserved for a follow-up phase' },
    { id: 'permission.mode', supported: true, mode: 'native', reliability: 'best_effort',
      notes: 'ACP agents may emit mode updates; exact modes are agent-defined' },
    { id: 'session.abort', supported: true, mode: 'native', reliability: 'best_effort',
      notes: 'Mapped to ACP session/cancel' },
    { id: 'session.background_task', supported: false,
      notes: 'No MyClaudia background task process tracking in the experimental ACP adapter' },
  ],
};

export const ACP_POLICY: ProviderPolicy = {};

export const ACP_MANIFEST = ACP_CAPABILITY_MANIFEST;
