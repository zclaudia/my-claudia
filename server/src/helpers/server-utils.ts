import * as path from 'path';
import type { SystemInfo } from '../providers/types.js';

// Commands that can be handled using system info from init message
export const SYSTEM_INFO_COMMANDS = ['/status'];

export function normalizeSessionWorkingDirectory(
  workingDirectory: string | null | undefined,
  rootPath: string | null | undefined,
): string | null {
  const normalize = (value: string | null | undefined): string | null => {
    if (!value) return null;
    return path.normalize(value);
  };

  const normalizedWorkingDirectory = normalize(workingDirectory);
  const normalizedRootPath = normalize(rootPath);

  if (!normalizedWorkingDirectory) return null;
  if (normalizedRootPath && normalizedWorkingDirectory === normalizedRootPath) return null;

  return normalizedWorkingDirectory;
}

export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

/**
 * Detect if a tool call is a sudo command that needs a password.
 * Returns true for Bash/shell tool calls containing sudo.
 */
export function isSudoCommand(toolName: string, toolInput: unknown): boolean {
  const bashTools = ['bash', 'execute_command', 'run_terminal_cmd', 'terminal'];
  if (!bashTools.includes(toolName.toLowerCase())) return false;

  const input = toolInput as { command?: string } | undefined;
  if (!input?.command) return false;

  return /(?:^|&&|\|\||;|\||\$\()[\s]*sudo\s/m.test(input.command);
}

export function isBashLikeTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'bash' || lower === 'execute_command' || lower === 'run_terminal_cmd' || lower === 'terminal';
}

export function providerSupportsNativePlanMode(providerType: string): boolean {
  return providerType === 'claude' || providerType === 'cursor' || providerType === 'codex';
}

export function buildNonNativePlanPrompt(providerType: string): string {
  return [
    'You are in STRICT PLAN MODE (enforced by platform policy).',
    `Provider: ${providerType}.`,
    '',
    'Rules:',
    '- Do analysis and planning only.',
    '- Do NOT modify files, create files, delete files, or run mutating shell commands.',
    '- If implementation is needed, describe it as a future execution plan.',
    '',
    'Output format:',
    '1) Goal',
    '2) Assumptions',
    '3) Step-by-step plan',
    '4) Risks/unknowns',
    '5) Verification checklist',
  ].join('\n');
}

export function buildPlanDocumentPrompt(taskId: string): string {
  return [
    'Plan document requirement:',
    `- Keep the plan synchronized in: .supervision/plans/task-${taskId}.plan.md`,
    '- Use markdown headings: # Goal, # Scope, # Steps, # Verification',
    '- Optional headings: # Risks, # Assumptions',
  ].join('\n');
}

/**
 * Rewrite a sudo command to inject the password via stdin using printf (shell builtin).
 * printf is used instead of echo because it's a builtin in most shells,
 * so the password won't appear in the process list (`ps`).
 *
 * Original: `sudo apt install vim`
 * Rewritten: `printf '%s\n' '<password>' | sudo -S apt install vim`
 *
 * For chained commands (&&, ;), only rewrites sudo invocations.
 */
export function rewriteSudoCommand(command: string, password: string): string {
  const escaped = password.replace(/'/g, "'\\''");
  return command.replace(
    /((?:^|(?:&&|\|\||;|\|)\s*))sudo\s+(?!-S\s)/gm,
    (_, prefix) => `${prefix}printf '%s\\n' '${escaped}' | sudo -S `,
  );
}

// Process @ mentions in user input, converting them to context hints for Claude
export function processAtMentions(input: string, projectRoot: string | null): string {
  if (!projectRoot) return input;

  const atPattern = /@([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/g;
  const mentions: string[] = [];

  let match;
  while ((match = atPattern.exec(input)) !== null) {
    const relativePath = match[1];
    const absolutePath = path.join(projectRoot, relativePath);
    mentions.push(absolutePath);
  }

  if (mentions.length === 0) return input;

  const contextHint = mentions
    .map(p => `Please read the file at ${p} for context.`)
    .join('\n');

  return `[Context Reference]\n${contextHint}\n\n${input}`;
}

export function buildStatusOutput(systemInfo: SystemInfo): string {
  const lines: string[] = [];

  if (systemInfo.model) {
    lines.push(`**Model:** ${systemInfo.model}`);
  }
  if (systemInfo.claudeCodeVersion) {
    lines.push(`**Claude Code Version:** ${systemInfo.claudeCodeVersion}`);
  }
  if (systemInfo.cwd) {
    lines.push(`**Working Directory:** ${systemInfo.cwd}`);
  }
  if (systemInfo.permissionMode) {
    lines.push(`**Permission Mode:** ${systemInfo.permissionMode}`);
  }
  if (systemInfo.apiKeySource) {
    lines.push(`**API Key Source:** ${systemInfo.apiKeySource}`);
  }
  if (systemInfo.tools && systemInfo.tools.length > 0) {
    lines.push(`**Available Tools:** ${systemInfo.tools.length}`);
    lines.push(`  ${systemInfo.tools.join(', ')}`);
  }
  if (systemInfo.mcpServers && systemInfo.mcpServers.length > 0) {
    lines.push(`**MCP Servers:** ${systemInfo.mcpServers.map(s => `${s.name} (${s.status})`).join(', ')}`);
  }
  if (systemInfo.slashCommands && systemInfo.slashCommands.length > 0) {
    lines.push(`**Slash Commands:** ${systemInfo.slashCommands.join(', ')}`);
  }
  if (systemInfo.agents && systemInfo.agents.length > 0) {
    lines.push(`**Agents:** ${systemInfo.agents.join(', ')}`);
  }
  return lines.join('\n');
}

export function formatProviderErrorMessage(raw: string, providerType?: string): string {
  const msg = raw.trim();
  const lower = msg.toLowerCase();
  const provider = providerType ? providerType.toUpperCase() : 'Provider';
  const isExpiredClaudeOAuth =
    providerType === 'claude' &&
    (
      lower.includes('oauth token has expired') ||
      (lower.includes('authentication_error') && lower.includes('token has expired')) ||
      (lower.includes('failed to authenticate') && lower.includes('401'))
    );

  if (isExpiredClaudeOAuth) {
    return `Claude authentication expired on this machine. Re-login with \`claude auth login\` and retry. (${msg})`;
  }

  const isLimitLike =
    lower.includes('rate limit') ||
    lower.includes('ratelimit') ||
    lower.includes('too many requests') ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota') ||
    lower.includes('billing') ||
    lower.includes('usage limit') ||
    lower.includes('429');

  if (!isLimitLike) return msg || 'Unknown error';
  return `${provider} request limit reached. Please wait and retry, or switch account/model. (${msg})`;
}

export function isHardQuotaExceededError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('insufficient_quota') ||
    lower.includes('quota exceeded') ||
    lower.includes('billing hard limit') ||
    lower.includes('billing limit') ||
    lower.includes('usage limit reached') ||
    lower.includes('credit balance') ||
    lower.includes('subscription quota') ||
    lower.includes('monthly limit reached')
  );
}

const INTERACTION_TOOL_DESCRIPTIONS: Record<string, string> = {
  update_todo_list: '**update_todo_list**: Show/update a visible task list for the user. Call this to track progress on multi-step tasks. Each call replaces the previous list.',
  ask_user_form: '**ask_user_form**: Present a structured form when you need specific input from the user — multiple fields, choices, or confirmations. The form blocks until the user responds.',
  request_approval: '**request_approval**: Request user approval before proceeding with a destructive, irreversible, or high-impact action. Blocks until the user approves or rejects. The response contains { approved: true/false, reason?: string }.',
  push_file: '**push_file**: Push a local file to the user\'s device. Use this when you build, generate, or export files (images, APKs, binaries, archives, documents, etc.) that the user needs. Images and small files (<500KB) auto-download; larger files show a download notification. Prefer this over curl to push files.',
  enter_plan_mode: '**enter_plan_mode**: Enter plan mode to analyze and plan before executing. Use for complex multi-step tasks. In plan mode, only use read-only tools.',
  exit_plan_mode: '**exit_plan_mode**: Exit plan mode with your completed plan for user review. Blocks until the user approves or denies. If denied, read the feedback and revise.',
};

export function buildInteractionToolPrompt(toolIds: string[]): string {
  const descriptions = toolIds
    .map(id => INTERACTION_TOOL_DESCRIPTIONS[id])
    .filter(Boolean)
    .map(d => `- ${d}`)
    .join('\n');
  if (!descriptions) return '';
  return `## Interaction Tools\nYou have access to these interaction tools via MCP:\n${descriptions}`;
}

export function buildFilePushContext(apiUrl: string, sessionId: string): string {
  return `## File Push (send files to user's device)
When you build or generate files (APK, image, binary, export, etc.) that the user needs, push them:
\`\`\`bash
curl -s -X POST ${apiUrl}/api/files/push \\
  -H "Content-Type: application/json" \\
  -d '{"filePath":"/absolute/path/to/file","sessionId":"${sessionId}","description":"Brief description"}'
\`\`\`
Images and files <500KB auto-download; larger files show a download notification.`;
}
