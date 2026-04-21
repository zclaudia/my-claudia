/**
 * Shell command parsing engine for the permission evaluator.
 *
 * Pure functions — no external dependencies except `path`.
 * Handles tokenization, compound command splitting, command substitution
 * extraction, normalization, and wrapper command extraction.
 */
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Types & Constants
// ============================================

export interface ShellToken {
  value: string;
}

export const OUTSIDE_WORKSPACE_EXECUTABLE_BASENAMES = new Set([
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

export const TEXT_VALUE_FLAGS_BY_COMMAND = new Map<string, Set<string>>([
  ['git commit', new Set(['-m', '--message'])],
]);

// ============================================
// Tokenization
// ============================================

export function tokenizeShellWords(command: string): ShellToken[] {
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

export function getCommandSignature(tokens: ShellToken[]): string | null {
  const commandTokens = tokens
    .map((token) => token.value)
    .filter((value) => value && !value.includes('='));
  if (commandTokens.length === 0) return null;
  if (commandTokens[0] === 'git' && commandTokens[1]) {
    return `git ${commandTokens[1]}`;
  }
  return commandTokens[0];
}

export function shouldSkipTokenAsTextArgument(tokens: ShellToken[], index: number): boolean {
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

export function shouldIgnoreOutsideWorkspaceExecutable(tokens: ShellToken[], index: number): boolean {
  const token = tokens[index]?.value;
  if (!token?.startsWith('/')) return false;

  const firstCommandIndex = tokens.findIndex((candidate) => candidate.value && !candidate.value.includes('='));
  if (firstCommandIndex !== index) return false;

  return OUTSIDE_WORKSPACE_EXECUTABLE_BASENAMES.has(path.basename(token).toLowerCase());
}

// ============================================
// Path Extraction & Workspace Validation
// ============================================

export function extractPathsFromCommand(command: string): string[] {
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

export function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedRoot = path.resolve(rootPath);
  return resolved.startsWith(resolvedRoot + path.sep) || resolved === resolvedRoot;
}

export function normalizeExternalRoot(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    if (filePath.endsWith(path.sep)) return resolved.replace(new RegExp(`${path.sep}+$`), '');
    return path.dirname(resolved);
  }
}

// ============================================
// Compound Command Splitting
// ============================================

export function splitCompoundCommand(command: string): string[] {
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

// ============================================
// Command Substitution Extraction
// ============================================

export function extractCommandSubstitutions(command: string): string[] {
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

// ============================================
// Shell Fragment Normalization
// ============================================

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

export function normalizeRememberableShellFragment(fragment: string): string | null {
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

export function unwrapGroupedFragment(fragment: string): string | null {
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

// ============================================
// Wrapper Command Extraction
// ============================================

export function extractFindExecCommands(fragment: string): string[] {
  const matches = fragment.matchAll(/(?:^|\s)-exec\s+(.+?)(?:\s+(?:\\;|;|\+)|$)/g);
  return [...matches]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => !!value);
}

export function extractXargsCommands(fragment: string): string[] {
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

export function extractShellWrapperCommands(fragment: string): string[] {
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

export function extractHeredocCommands(fragment: string): string[] {
  const match = fragment.match(/^(.*?)(?:\s*<<-?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?)/);
  if (!match?.[1]) return [];
  const prefix = match[1].trim();
  return prefix ? [prefix] : [];
}

export function extractParallelCommands(fragment: string): string[] {
  const match = fragment.match(/\bparallel\b(?:\s+\S+)*\s+(['"])([\s\S]+?)\1\s+::/);
  if (!match?.[2]) return [];
  return [match[2].trim()];
}

// ============================================
// Rememberable Command Extraction (Orchestrator)
// ============================================

export function extractRememberableShellCommands(command: string): string[] {
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
