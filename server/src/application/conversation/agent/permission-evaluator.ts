import type {
  AgentPermissionPolicy,
  AgentPermissionRule,
  CategoryAction,
  CategoryProfile,
  PermissionCategory,
  EvaluationContext,
  UnifiedPermissionPolicy,
} from '@my-claudia/shared/interaction/permissions';
import {
  DEFAULT_SENSITIVE_PATTERNS,
  DEFAULT_GLOBAL_GUARDS,
  DEFAULT_UNIFIED_POLICY,
  DEFAULT_UNIFIED_PROFILE,
  normalizeToUnifiedPolicy,
  ensureEscalateAlways,
} from '@my-claudia/shared/interaction/permissions';
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';

// ============================================
// Types
// ============================================

export type EvaluationResult = 'approve' | 'deny' | 'escalate';
export type RememberedDecision = 'allow' | 'deny';
export type MatchedPermissionRule =
  | 'Always escalate'
  | 'Custom rule'
  | 'Sensitive file access'
  | 'Outside workspace access'
  | 'Category: fileRead'
  | 'Category: fileWrite'
  | 'Category: shellSafe'
  | 'Category: networkOps'
  | 'Category: destructiveOps'
  | 'Category: userQuestions';

// ============================================
// Shared Utilities
// ============================================

/** Extract file_path from toolInput (used by Write, Edit, Read, etc.) */
function extractFilePath(toolInput: unknown): string | null {
  if (toolInput && typeof toolInput === 'object' && 'file_path' in toolInput) {
    const fp = (toolInput as { file_path: unknown }).file_path;
    if (typeof fp === 'string') return fp;
  }
  return null;
}

/** Extract Bash command from toolInput or detail */
export function extractBashCommand(toolInput: unknown, detail: string): string | null {
  const normalizeCommandText = (value: string): string => {
    return value
      .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  };

  if (toolInput && typeof toolInput === 'object' && 'command' in toolInput) {
    const cmd = (toolInput as { command: unknown }).command;
    if (typeof cmd === 'string') return normalizeCommandText(cmd);
  }
  if (detail) return normalizeCommandText(detail);
  return null;
}

export function isBashLikeTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === 'bash'
    || lower === 'execute_command'
    || lower === 'run_terminal_cmd'
    || lower === 'terminal'
    || lower === 'agent_shell';
}

function hasToolNameSuffix(toolName: string, suffix: string): boolean {
  return toolName === suffix
    || toolName.endsWith(`_${suffix}`)
    || toolName.endsWith(`-${suffix}`)
    || toolName.endsWith(`:${suffix}`);
}

export function isInternalInteractionTool(toolName: string): boolean {
  // NOTE: ExitPlanMode (Claude SDK built-in, PascalCase) is intentionally NOT
  // listed here. The built-in has no custom handler — if we auto-approve it at
  // the permission layer, plan mode exits silently with no user approval.
  // It must escalate through the normal permission flow so the frontend can
  // render the plan-review UI (see InlinePermissionRequest.tsx).
  // The snake_case `exit_plan_mode` MCP tool stays in the list because its
  // handler (interaction-tools.ts) dispatches its own approval interaction.
  return hasToolNameSuffix(toolName, 'update_todo_list')
    || hasToolNameSuffix(toolName, 'ask_user_form')
    || hasToolNameSuffix(toolName, 'request_approval')
    || hasToolNameSuffix(toolName, 'push_file')
    || hasToolNameSuffix(toolName, 'enter_plan_mode')
    || hasToolNameSuffix(toolName, 'exit_plan_mode')
    || toolName === 'EnterPlanMode';
}

function isBlockingInteractionTool(toolName: string): boolean {
  return hasToolNameSuffix(toolName, 'ask_user_form')
    || hasToolNameSuffix(toolName, 'request_approval')
    || hasToolNameSuffix(toolName, 'exit_plan_mode')
    || toolName === 'ExitPlanMode';
}

interface ShellToken {
  value: string;
}

const OUTSIDE_WORKSPACE_EXECUTABLE_BASENAMES = new Set([
  'bash',
  'sh',
  'zsh',
  'fish',
  'env',
  'node',
  'nodejs',
  'python',
  'python3',
  'ruby',
  'perl',
  'pnpm',
  'npm',
  'yarn',
]);

const TEXT_VALUE_FLAGS_BY_COMMAND = new Map<string, Set<string>>([
  ['git commit', new Set(['-m', '--message'])],
]);

function tokenizeShellWords(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const pushCurrent = () => {
    if (!current) return;
    tokens.push({ value: current });
    current = '';
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      if (inSingle) {
        current += ch;
      } else {
        escaped = true;
      }
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      pushCurrent();
      continue;
    }

    current += ch;
  }

  pushCurrent();
  return tokens;
}

function getCommandSignature(tokens: ShellToken[]): string | null {
  const commandTokens = tokens
    .map((token) => token.value)
    .filter((value) => value && !value.includes('='));
  if (commandTokens.length === 0) return null;
  if (commandTokens[0] === 'git' && commandTokens[1]) {
    return `git ${commandTokens[1]}`;
  }
  return commandTokens[0];
}

function shouldSkipTokenAsTextArgument(tokens: ShellToken[], index: number): boolean {
  const signature = getCommandSignature(tokens);
  if (!signature) return false;

  const rules = TEXT_VALUE_FLAGS_BY_COMMAND.get(signature);
  if (rules?.has('*')) {
    return index > 0;
  }

  const previous = tokens[index - 1]?.value;
  if (!previous || !rules) return false;
  return rules.has(previous);
}

function shouldIgnoreOutsideWorkspaceExecutable(tokens: ShellToken[], index: number): boolean {
  const token = tokens[index]?.value;
  if (!token?.startsWith('/')) return false;

  const firstCommandIndex = tokens.findIndex((candidate) => candidate.value && !candidate.value.includes('='));
  if (firstCommandIndex !== index) return false;

  return OUTSIDE_WORKSPACE_EXECUTABLE_BASENAMES.has(path.basename(token).toLowerCase());
}

function extractPathsFromCommand(command: string): string[] {
  const paths = new Set<string>();
  for (const segment of splitCompoundCommand(command)) {
    const tokens = tokenizeShellWords(segment);
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token.value.startsWith('/')) continue;
      if (shouldSkipTokenAsTextArgument(tokens, i)) continue;
      if (shouldIgnoreOutsideWorkspaceExecutable(tokens, i)) continue;
      paths.add(token.value);
    }
  }
  return [...paths];
}

function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootPath);
  return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot;
}

function normalizeExternalRoot(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    if (filePath.endsWith(path.sep)) return resolved.replace(new RegExp(`${path.sep}+$`), '');
    return path.dirname(resolved);
  }
}

export function getOutsideWorkspacePaths(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string
): string[] {
  if (!rootPath) return [];

  const paths: string[] = [];
  const filePath = extractFilePath(toolInput);
  if (filePath && !isPathWithinRoot(filePath, rootPath)) {
    paths.push(path.resolve(filePath));
  }

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      for (const p of extractPathsFromCommand(command)) {
        if (!isPathWithinRoot(p, rootPath)) {
          paths.push(path.resolve(p));
        }
      }
    }
  }

  return [...new Set(paths)];
}

export function getOutsideWorkspaceRootsToRemember(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string
): string[] {
  return getOutsideWorkspacePaths(toolName, toolInput, detail, rootPath)
    .map((filePath) => normalizeExternalRoot(filePath))
    .filter((dir, index, arr) => arr.indexOf(dir) === index);
}

export function isOutsideWorkspacePathAllowed(
  toolName: string,
  toolInput: unknown,
  detail: string,
  rootPath: string,
  allowedRoots: Iterable<string>
): boolean {
  const outsidePaths = getOutsideWorkspacePaths(toolName, toolInput, detail, rootPath);
  if (outsidePaths.length === 0) return false;
  const roots = [...allowedRoots].map((root) => path.resolve(root));
  return outsidePaths.every((outsidePath) => (
    roots.some((root) => isPathWithinRoot(outsidePath, root))
  ));
}

// ============================================
// Tool Categories
// ============================================

const READONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];

const EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)\b/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/i,
  /\bformat\b/i,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bgit\s+push\s+(-f|--force)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bchmod\s+777\b/,
  /\bchown\b.*-R\b/,
  />\s*\/dev\/sd[a-z]/,
  /\bcurl\b.*\|\s*(ba)?sh\b/,
  /\bwget\b.*\|\s*(ba)?sh\b/,
];

const NETWORK_BASH_PATTERNS = [
  /\bcurl\b/,
  /\bwget\b/,
  /\bssh\b/,
  /\bscp\b/,
  /\brsync\b.*:/,
  /\bnpm\s+publish\b/,
  /\byarn\s+publish\b/,
  /\bgit\s+push\b/,
  /\bgit\s+fetch\b/,
  /\bgit\s+pull\b/,
  /\bgit\s+clone\b/,
  /\bdocker\s+push\b/,
  /\bdocker\s+pull\b/,
  /\bnc\b/,
  /\btelnet\b/,
];

// ============================================
// Internal Guard Checks
// ============================================

function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return DEFAULT_SENSITIVE_PATTERNS.some(p => minimatch(basename, p, { dot: true }));
}

function targetsSensitiveFile(toolName: string, toolInput: unknown, detail: string): boolean {
  const filePath = extractFilePath(toolInput);
  if (filePath && isSensitiveFile(filePath)) return true;

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      return extractPathsFromCommand(command).some(p => isSensitiveFile(p));
    }
  }
  return false;
}

function targetsOutsideWorkspace(toolName: string, toolInput: unknown, detail: string, rootPath: string): boolean {
  if (!rootPath) return false;

  const filePath = extractFilePath(toolInput);
  if (filePath && !isPathWithinRoot(filePath, rootPath)) return true;

  if (isBashLikeTool(toolName)) {
    const command = extractBashCommand(toolInput, detail);
    if (command) {
      return extractPathsFromCommand(command).some(p => !isPathWithinRoot(p, rootPath));
    }
  }
  return false;
}

function isNetworkCommand(toolInput: unknown, detail: string): boolean {
  const command = extractBashCommand(toolInput, detail);
  if (!command) return false;
  return NETWORK_BASH_PATTERNS.some(p => p.test(command));
}

function isDangerousCommand(toolInput: unknown, detail: string): boolean {
  const command = extractBashCommand(toolInput, detail);
  if (!command) return true; // No command = can't verify safety = escalate
  return DANGEROUS_BASH_PATTERNS.some(p => p.test(command));
}

// ============================================
// Tool Classification
// ============================================

/** Classify a tool call into a permission category */
export function classify(toolName: string, toolInput: unknown, detail: string): PermissionCategory {
  if (toolName === 'AskUserQuestion') return 'userQuestions';
  if (isBlockingInteractionTool(toolName)) return 'userQuestions';
  if (READONLY_TOOLS.includes(toolName)) return 'fileRead';
  if (EDIT_TOOLS.includes(toolName)) return 'fileWrite';

  if (isBashLikeTool(toolName)) {
    if (isDangerousCommand(toolInput, detail)) return 'destructiveOps';
    if (isNetworkCommand(toolInput, detail)) return 'networkOps';
    return 'shellSafe';
  }

  // Task tool and other unknown tools → shellSafe (custom rules can override)
  return 'shellSafe';
}

/** Map a CategoryAction to an EvaluationResult */
function actionToResult(action: CategoryAction): EvaluationResult {
  switch (action) {
    case 'auto-approve': return 'approve';
    case 'ask': return 'escalate';
    case 'block': return 'deny';
  }
}

// ============================================
// Remember Key Builder
// ============================================

function splitCompoundCommand(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let commandSubstitutionDepth = 0;
  let backtickSubstitution = false;
  let groupDepth = 0;
  let braceDepth = 0;
  let parameterExpansionDepth = 0;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      current += ch;
      escaped = true;
      continue;
    }

    if (!inSingle && ch === '$' && next === '(') {
      current += '$(';
      commandSubstitutionDepth += 1;
      i += 1;
      continue;
    }

    if (!inSingle && ch === '$' && next === '{') {
      current += '${';
      parameterExpansionDepth += 1;
      i += 1;
      continue;
    }

    if (!inSingle && ch === '`') {
      current += ch;
      backtickSubstitution = !backtickSubstitution;
      continue;
    }

    if (!inSingle && !inDouble && !backtickSubstitution && commandSubstitutionDepth === 0 && ch === '(') {
      current += ch;
      groupDepth += 1;
      continue;
    }

    if (!inSingle && !inDouble && !backtickSubstitution && commandSubstitutionDepth === 0 && ch === ')' && groupDepth > 0) {
      current += ch;
      groupDepth -= 1;
      continue;
    }

    if (!inSingle && !inDouble && !backtickSubstitution && commandSubstitutionDepth === 0 && ch === '{' && command[i - 1] !== '$') {
      current += ch;
      braceDepth += 1;
      continue;
    }

    if (!inSingle && !inDouble && parameterExpansionDepth > 0 && ch === '}') {
      current += ch;
      parameterExpansionDepth -= 1;
      continue;
    }

    if (!inSingle && !inDouble && !backtickSubstitution && commandSubstitutionDepth === 0 && parameterExpansionDepth === 0 && ch === '}' && braceDepth > 0) {
      current += ch;
      braceDepth -= 1;
      continue;
    }

    if (!inSingle && !inDouble && commandSubstitutionDepth > 0 && ch === '(') {
      current += ch;
      commandSubstitutionDepth += 1;
      continue;
    }

    if (!inSingle && !inDouble && commandSubstitutionDepth > 0 && ch === ')') {
      current += ch;
      commandSubstitutionDepth -= 1;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble && !backtickSubstitution && commandSubstitutionDepth === 0 && groupDepth === 0 && braceDepth === 0) {
      const tripleSep = `${ch}${next || ''}${command[i + 2] || ''}`;
      const doubleSep = `${ch}${next || ''}`;
      if (tripleSep === ';;&') {
        const normalized = current.trim();
        if (normalized) segments.push(normalized);
        current = '';
        i += 2;
        continue;
      }
      if (doubleSep === '&&' || doubleSep === '||' || doubleSep === ';;' || doubleSep === ';&') {
        const normalized = current.trim();
        if (normalized) segments.push(normalized);
        current = '';
        i += 1;
        continue;
      }
      if (ch === ';' || ch === '|') {
        const normalized = current.trim();
        if (normalized) segments.push(normalized);
        current = '';
        continue;
      }
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) segments.push(tail);
  return segments;
}

function extractCommandSubstitutions(command: string): string[] {
  const substitutions: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && ch === '`') {
      let inner = '';
      i += 1;
      for (; i < command.length; i += 1) {
        const innerChar = command[i];
        if (innerChar === '\\') {
          if (i + 1 < command.length) {
            inner += innerChar + command[i + 1];
            i += 1;
          }
          continue;
        }
        if (innerChar === '`') {
          break;
        }
        inner += innerChar;
      }
      const normalizedBacktick = inner.trim();
      if (normalizedBacktick) {
        substitutions.push(normalizedBacktick);
        substitutions.push(...extractCommandSubstitutions(normalizedBacktick));
      }
      continue;
    }

    if (inSingle || (ch !== '$' || next !== '(')) {
      continue;
    }

    let depth = 1;
    let inner = '';
    i += 2;

    for (; i < command.length; i += 1) {
      const innerChar = command[i];
      const innerNext = command[i + 1];
      inner += innerChar;

      if (innerChar === '\\') {
        if (i + 1 < command.length) {
          inner += command[i + 1];
          i += 1;
        }
        continue;
      }

      if (innerChar === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }

      if (innerChar === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }

      if (inSingle) {
        continue;
      }

      if (innerChar === '$' && innerNext === '(') {
        depth += 1;
        inner += innerNext;
        i += 1;
        continue;
      }

      if (innerChar === ')') {
        depth -= 1;
        if (depth === 0) {
          inner = inner.slice(0, -1);
          break;
        }
      }
    }

    const normalized = inner.trim();
    if (normalized) {
      substitutions.push(normalized);
      substitutions.push(...extractCommandSubstitutions(normalized));
    }
  }

  return substitutions;
}

const LEADING_CONTROL_KEYWORDS = /^(?:(?:do|then|else|elif|if|while|until|time)\s+)+/;
const TRAILING_CONTROL_KEYWORDS = /\s*(?:fi|done|esac)\s*$/;
const CASE_PREFIX = /^case\b[\s\S]*?\bin\b\s*/;
const CASE_ARM_PREFIX = /^[^()\s][^()]*\)\s*/;
const STRUCTURAL_PREFIXES = [
  /^for\b/,
  /^while\b/,
  /^until\b/,
  /^case\b/,
  /^select\b/,
  /^function\b/,
  /^[A-Za-z_][A-Za-z0-9_]*\s+in\b/,
];

function normalizeRememberableShellFragment(fragment: string): string | null {
  const normalized = fragment
    .trim()
    .replace(CASE_PREFIX, '')
    .replace(CASE_ARM_PREFIX, '')
    .replace(LEADING_CONTROL_KEYWORDS, '')
    .replace(TRAILING_CONTROL_KEYWORDS, '')
    .trim();

  if (!normalized) return null;
  if (STRUCTURAL_PREFIXES.some((pattern) => pattern.test(normalized))) {
    return null;
  }
  return normalized;
}

function unwrapGroupedFragment(fragment: string): string | null {
  const normalized = fragment.trim();
  if (normalized.length < 2) return null;

  const pairs: Array<[string, string]> = [['(', ')'], ['{', '}']];
  for (const [open, close] of pairs) {
    if (!normalized.startsWith(open) || !normalized.endsWith(close)) continue;

    let inSingle = false;
    let inDouble = false;
    let escaped = false;
    let depth = 0;

    for (let i = 0; i < normalized.length; i += 1) {
      const ch = normalized[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue;
      }
      if (inSingle || inDouble) continue;

      if (ch === open) depth += 1;
      if (ch === close) {
        depth -= 1;
        if (depth === 0 && i !== normalized.length - 1) {
          return null;
        }
      }
    }

    if (depth === 0) {
      return normalized.slice(1, -1).trim();
    }
  }

  return null;
}

function extractFindExecCommands(fragment: string): string[] {
  const matches = fragment.matchAll(/(?:^|\s)-exec\s+(.+?)(?:\s+(?:\\;|;|\+)|$)/g);
  return [...matches]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => !!value);
}

function extractXargsCommands(fragment: string): string[] {
  const tokens = fragment.trim().split(/\s+/);
  const xargsIndex = tokens.findIndex((token) => token === 'xargs');
  if (xargsIndex === -1) return [];

  const optionsWithValues = new Set(['-E', '-I', '-L', '-n', '-P', '-d']);
  let index = xargsIndex + 1;

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token.startsWith('-')) break;

    if (token === '-I' || token === '-E' || token === '-L' || token === '-n' || token === '-P' || token === '-d') {
      index += 2;
      continue;
    }

    if ([...optionsWithValues].some((flag) => token.startsWith(flag) && token !== flag)) {
      index += 1;
      continue;
    }

    index += 1;
  }

  const command = tokens.slice(index).join(' ').trim();
  return command ? [command] : [];
}

function extractShellWrapperCommands(fragment: string): string[] {
  const patterns = [
    /^(?:nohup\s+)?(?:sudo\s+)?(?:command\s+)?(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)*)?(?:sh|bash|zsh)\b(?:\s+-[A-Za-z]+)*\s+-[A-Za-z]*c[A-Za-z]*\s+(['"])([\s\S]+)\1/,
    /\b(?:docker|podman)\s+exec\b(?:\s+\S+)*\s+(?:sh|bash|zsh)\b(?:\s+-[A-Za-z]+)*\s+-c\s+(['"])([\s\S]+)\1/,
    /^(?:sudo\s+)?ssh\b(?:\s+\S+)*\s+(['"])([\s\S]+)\1/,
    /\b(?:tmux|screen)\b(?:\s+\S+)*\s+(?:sh|bash|zsh)\b(?:\s+-[A-Za-z]+)*\s+-c\s+(['"])([\s\S]+)\1/,
    /\btmux\b(?:\s+\S+)*\s+(['"])([\s\S]+)\1/,
  ];

  for (const pattern of patterns) {
    const match = fragment.match(pattern);
    if (match?.[2]) {
      return [match[2].trim()];
    }
  }

  return [];
}

function extractHeredocCommands(fragment: string): string[] {
  const match = fragment.match(/^(.*?)(?:\s*<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?)/);
  if (!match?.[1]) return [];
  const prefix = match[1].trim();
  return prefix ? [prefix] : [];
}

function extractParallelCommands(fragment: string): string[] {
  const match = fragment.match(/\bparallel\b(?:\s+\S+)*\s+(['"])([\s\S]+?)\1\s+::/);
  if (!match?.[2]) return [];
  return [match[2].trim()];
}

function extractRememberableShellCommands(command: string): string[] {
  const extracted: string[] = [];
  for (const fragment of splitCompoundCommand(command)) {
    for (const substitution of extractCommandSubstitutions(fragment)) {
      extracted.push(...extractRememberableShellCommands(substitution));
    }
    for (const execCommand of extractFindExecCommands(fragment)) {
      extracted.push(...extractRememberableShellCommands(execCommand));
    }
    for (const xargsCommand of extractXargsCommands(fragment)) {
      extracted.push(...extractRememberableShellCommands(xargsCommand));
    }
    for (const wrappedCommand of extractShellWrapperCommands(fragment)) {
      extracted.push(...extractRememberableShellCommands(wrappedCommand));
    }
    for (const heredocCommand of extractHeredocCommands(fragment)) {
      extracted.push(...extractRememberableShellCommands(heredocCommand));
    }
    for (const parallelCommand of extractParallelCommands(fragment)) {
      extracted.push(...extractRememberableShellCommands(parallelCommand));
    }
    const normalized = normalizeRememberableShellFragment(fragment);
    if (normalized) {
      const unwrapped = unwrapGroupedFragment(normalized);
      if (unwrapped) {
        extracted.push(...extractRememberableShellCommands(unwrapped));
      } else {
        extracted.push(normalized);
      }
    }
  }
  return [...new Set(extracted)];
}

/** Build stable remember keys for a tool call. */
export function buildRememberKeys(toolName: string, toolInput: unknown, detail: string): string[] {
  if (!isBashLikeTool(toolName)) {
    return [toolName];
  }

  const cmd = extractBashCommand(toolInput, detail);
  if (!cmd) {
    return ['Bash'];
  }

  const normalized = cmd.trim();
  const keys = [`Bash:${normalized}`];
  for (const segment of extractRememberableShellCommands(normalized)) {
    keys.push(`Bash:${segment}`);
  }

  return [...new Set(keys)];
}

/** Backward-compatible single remember key accessor. */
export function buildRememberKey(toolName: string, toolInput: unknown, detail: string): string {
  return buildRememberKeys(toolName, toolInput, detail)[0];
}

export function resolveRememberedDecision(
  lookup: Pick<Map<string, RememberedDecision>, 'get'>,
  toolName: string,
  toolInput: unknown,
  detail: string
): RememberedDecision | null {
  return lookup.get(buildRememberKey(toolName, toolInput, detail)) ?? null;
}

interface PermissionMemoryRow {
  remember_key: string;
  decision: RememberedDecision;
}

interface PermissionMemoryDb {
  prepare: (sql: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement uses variadic params and returns row types vary by query
    all: (...args: any[]) => Array<Record<string, unknown>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (...args: any[]) => unknown;
  };
}

interface OutsideWorkspaceMemoryRow {
  allowed_root: string;
}

export function loadSessionRememberedDecisions(
  db: PermissionMemoryDb,
  sessionId: string
): Map<string, RememberedDecision> {
  const rows = db.prepare(
    'SELECT remember_key, decision FROM permission_memories WHERE session_id = ?'
  ).all(sessionId);
  return new Map(rows.map((row) => [row.remember_key as string, row.decision as RememberedDecision]));
}

export function persistSessionRememberedDecision(
  db: PermissionMemoryDb,
  sessionId: string,
  toolName: string,
  toolInput: unknown,
  detail: string,
  decision: RememberedDecision
): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO permission_memories (session_id, remember_key, decision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id, remember_key)
    DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at
  `).run(sessionId, buildRememberKey(toolName, toolInput, detail), decision, now, now);
}

export function loadProjectAllowedOutsideWorkspaceRoots(
  db: PermissionMemoryDb,
  projectId: string
): Set<string> {
  const rows = db.prepare(
    'SELECT allowed_root FROM permission_outside_workspace_roots WHERE project_id = ?'
  ).all(projectId);
  return new Set(rows.map((row) => row.allowed_root as string));
}

export function persistProjectAllowedOutsideWorkspaceRoots(
  db: PermissionMemoryDb,
  projectId: string,
  roots: string[]
): void {
  if (roots.length === 0) return;
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO permission_outside_workspace_roots (project_id, allowed_root, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, allowed_root)
    DO UPDATE SET updated_at = excluded.updated_at
  `);
  for (const root of roots) {
    stmt.run(projectId, root, now, now);
  }
}

export function getMatchedPermissionRule(
  toolName: string,
  toolInput: unknown,
  detail: string,
  policy: EffectivePolicy,
  context?: EvaluationContext
): MatchedPermissionRule | null {
  if (!policy.enabled) return null;

  const rootPath = context?.rootPath || process.cwd();

  if (policy.escalateAlways?.includes(toolName)) {
    return 'Always escalate';
  }

  const customResult = evaluateCustomRules(toolName, detail, policy.customRules || []);
  if (customResult === 'escalate') {
    return 'Custom rule';
  }

  if (policy.globalGuards.blockSensitiveFiles && targetsSensitiveFile(toolName, toolInput, detail)) {
    return 'Sensitive file access';
  }

  if (policy.globalGuards.blockOutsideWorkspace && targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) {
    return 'Outside workspace access';
  }

  const category = classify(toolName, toolInput, detail);
  if (resolveProfile(policy, context)[category] === 'ask') {
    return `Category: ${category}`;
  }

  return null;
}

// ============================================
// Custom Rules Evaluator
// ============================================

type CustomRuleResult = 'approve' | 'deny' | 'escalate' | 'continue';

function evaluateCustomRules(toolName: string, detail: string, rules: AgentPermissionRule[]): CustomRuleResult {
  for (const rule of rules) {
    if (rule.toolName === '*' || rule.toolName === toolName) {
      if (rule.pattern) {
        try {
          const re = new RegExp(rule.pattern, 'i');
          if (re.test(detail)) return rule.action;
        } catch {
          continue;
        }
      } else {
        return rule.action;
      }
    }
  }
  return 'continue';
}

// ============================================
// Category-Based Permission Evaluator
// ============================================

/** @deprecated Alias — all policies are now UnifiedPermissionPolicy */
export type EffectivePolicy = UnifiedPermissionPolicy;

/** @deprecated Always true — kept for backward compat of callers */
export function isUnifiedPolicy(_policy: EffectivePolicy): _policy is UnifiedPermissionPolicy {
  return true;
}

/** Resolve the active CategoryProfile from a policy */
function resolveProfile(policy: EffectivePolicy, _context?: EvaluationContext): CategoryProfile {
  return policy.profile;
}

/**
 * Permission evaluator — unified single-profile evaluation.
 *
 * Evaluation order:
 *   1. escalateAlways list
 *   2. Custom rules (first match wins)
 *   3. Global guards (sensitive files / outside workspace → escalate)
 *   4. Classify tool → category → look up profile → action
 */
export class PermissionEvaluator {
  evaluate(
    toolName: string,
    toolInput: unknown,
    detail: string,
    policy: EffectivePolicy,
    context?: EvaluationContext
  ): EvaluationResult {
    if (!policy.enabled) return 'escalate';

    const rootPath = context?.rootPath || process.cwd();

    // 1. escalateAlways
    if (policy.escalateAlways?.includes(toolName)) {
      return 'escalate';
    }

    // 2. Custom rules (first match wins)
    const customResult = evaluateCustomRules(toolName, detail, policy.customRules || []);
    if (customResult !== 'continue') {
      return customResult;
    }

    // 3. Global guards → escalate (user can override)
    if (policy.globalGuards.blockSensitiveFiles && targetsSensitiveFile(toolName, toolInput, detail)) {
      return 'escalate';
    }
    if (policy.globalGuards.blockOutsideWorkspace && targetsOutsideWorkspace(toolName, toolInput, detail, rootPath)) {
      return 'escalate';
    }

    // 4. Category-based evaluation
    const category = classify(toolName, toolInput, detail);
    const action = resolveProfile(policy, context)[category];

    return actionToResult(action);
  }
}

// ============================================
// Policy Utilities
// ============================================

/**
 * Detect whether a raw policy object is the old trustLevel format or new category format.
 */
function isLegacyPolicy(raw: unknown): raw is AgentPermissionPolicy {
  return raw !== null && typeof raw === 'object' && 'trustLevel' in (raw as Record<string, unknown>);
}

/**
 * Convert a legacy v1 trustLevel to a single CategoryProfile (v3).
 *
 * NOTE: v1/v2 had per-session-type profiles (regular/background/agent) where
 * background and agent sessions used stricter defaults (e.g. network blocked
 * for background, fileWrite=ask for agent). v3 intentionally unified to a
 * single profile for simplicity. The global settings UI has been v3-only since
 * its introduction. Legacy v1 data is converted using the `regular` profile,
 * which means old background/agent-specific restrictions are NOT preserved.
 * This is by design — administrators should use the unified profile to set
 * the desired policy across all session types.
 */
function trustLevelToProfile(trustLevel: string): CategoryProfile {
  switch (trustLevel) {
    case 'conservative':
      return { fileRead: 'auto-approve', fileWrite: 'ask', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' };
    case 'moderate':
      return { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' };
    case 'aggressive':
      return { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' };
    case 'full_trust':
      return { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'auto-approve', destructiveOps: 'block', userQuestions: 'ask' };
    default:
      return { ...DEFAULT_UNIFIED_PROFILE };
  }
}

/**
 * Normalize a policy from the database — handles v3 unified, v2 category, and v1 trustLevel formats.
 * Always returns UnifiedPermissionPolicy (v3).
 */
export function normalizePolicy(raw: unknown): UnifiedPermissionPolicy {
  if (!raw || typeof raw !== 'object') return DEFAULT_UNIFIED_POLICY;

  // v1 format: trustLevel-based — convert to v3
  if (isLegacyPolicy(raw)) {
    return {
      enabled: raw.enabled ?? false,
      profile: trustLevelToProfile(raw.trustLevel),
      globalGuards: { ...DEFAULT_UNIFIED_POLICY.globalGuards },
      customRules: raw.customRules || [],
      escalateAlways: ensureEscalateAlways(raw.escalateAlways),
      aiReview: { ...DEFAULT_UNIFIED_POLICY.aiReview },
    };
  }

  // v2/v3: delegate to shared
  return normalizeToUnifiedPolicy(raw);
}

/**
 * Merge a project-level override into the global policy.
 */
export function mergePolicy(
  globalPolicy: UnifiedPermissionPolicy,
  projectOverride?: Partial<UnifiedPermissionPolicy> | null
): UnifiedPermissionPolicy {
  if (!projectOverride) return globalPolicy;

  const merged: UnifiedPermissionPolicy = {
    ...globalPolicy,
    profile: { ...globalPolicy.profile, ...projectOverride.profile },
    globalGuards: { ...globalPolicy.globalGuards, ...projectOverride.globalGuards },
    aiReview: { ...globalPolicy.aiReview, ...projectOverride.aiReview },
  };

  if (projectOverride.enabled !== undefined) merged.enabled = projectOverride.enabled;
  if (projectOverride.customRules !== undefined) merged.customRules = projectOverride.customRules;
  if (projectOverride.escalateAlways !== undefined) merged.escalateAlways = projectOverride.escalateAlways;

  return merged;
}

/**
 * Read agent permission policy from database (handles v1/v2/v3 formats, always returns v3).
 */
export function getAgentPermissionPolicy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement.get() uses variadic params
  db: { prepare: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined } }
): UnifiedPermissionPolicy | null {
  try {
    const row = db.prepare(
      'SELECT permission_policy FROM agent_config WHERE id = 1'
    ).get() as { permission_policy: string | null } | undefined;

    if (!row?.permission_policy) return null;

    const raw = JSON.parse(row.permission_policy);
    return normalizePolicy(raw);
  } catch {
    return null;
  }
}

/**
 * Read project-level agent permission override from database.
 */
export function getProjectPermissionOverride(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement.get() uses variadic params
  db: { prepare: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined } },
  projectId: string
): Partial<UnifiedPermissionPolicy> | null {
  try {
    const row = db.prepare(
      'SELECT agent_permission_override FROM projects WHERE id = ?'
    ).get(projectId) as { agent_permission_override: string | null } | undefined;

    if (!row?.agent_permission_override) return null;

    const raw = JSON.parse(row.agent_permission_override);
    // If legacy format, convert and extract profile
    if (isLegacyPolicy(raw)) {
      const converted = normalizePolicy(raw);
      return { profile: converted.profile } as Partial<UnifiedPermissionPolicy>;
    }
    // If v2 format with profiles, extract regular as profile
    const obj = raw as Record<string, unknown>;
    if ('profiles' in obj && !('profile' in obj)) {
      const profiles = obj.profiles as Record<string, CategoryProfile>;
      return { profile: profiles.regular, ...('globalGuards' in obj ? { globalGuards: obj.globalGuards } : {}) } as Partial<UnifiedPermissionPolicy>;
    }
    return raw as Partial<UnifiedPermissionPolicy>;
  } catch {
    return null;
  }
}
