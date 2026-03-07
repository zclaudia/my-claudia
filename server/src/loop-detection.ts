/**
 * Loop detection utilities for tool calls
 */

/**
 * Generate a specific signature for a tool call to improve loop detection granularity.
 * Provider adapters may emit different shapes for the same semantic operation,
 * so we normalize tool name + key fields before generating signatures.
 */
export function generateToolSignature(
  toolName: string,
  toolInput?: Record<string, unknown>,
  _providerType?: string,
): string {
  const normalizedTool = normalizeToolName(toolName);

  if (normalizedTool === 'Task') {
    const subtype = pickString(toolInput, ['subagent_type', 'subagentType', 'agent', 'task_type', 'type']) || 'generic';
    const inBackground = pickBoolean(toolInput, ['run_in_background', 'runInBackground']);
    return `Task:${subtype}${inBackground === true ? ':bg' : inBackground === false ? ':fg' : ''}`;
  }

  // For Bash commands, include a richer command signature (command + key subcommand).
  const bashCommand = extractCommand(toolInput);
  if (normalizedTool === 'Bash' && bashCommand) {
    const raw = bashCommand.trim().replace(/\s+/g, ' ');
    const tokens = raw.split(' ').filter(Boolean);
    if (tokens.length === 0) return 'Bash';

    const sig: string[] = [tokens[0]];
    // Capture up to 2 significant sub-tokens to reduce false positives
    // (e.g. "git status" vs "git diff" should be different signatures).
    for (let i = 1; i < tokens.length && sig.length < 3; i++) {
      const t = tokens[i];
      if (!t || t.startsWith('-')) continue;
      sig.push(t);
    }
    return `Bash:${sig.join(' ')}`;
  }

  // For Read/Write/Edit, include file path with parent directory for better disambiguation.
  const filePath = extractFilePath(toolInput);
  if (['Read', 'Write', 'Edit'].includes(normalizedTool) && filePath) {
    const parts = filePath.split('/');
    const pathSignature = parts.length > 3
      ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      : parts[parts.length - 1] || filePath;
    return `${normalizedTool}:${pathSignature}`;
  }

  // For Grep, include pattern + path hint when available.
  if (normalizedTool === 'Grep') {
    const patternRaw = pickString(toolInput, ['pattern', 'query']);
    if (patternRaw) {
      const pattern = patternRaw.substring(0, 30);
      const pathRaw = pickString(toolInput, ['path', 'file_path', 'filePath']);
      const path = pathRaw ? pathRaw.split('/').slice(-2).join('/') : '';
      return path ? `Grep:${pattern}@${path}` : `Grep:${pattern}`;
    }
  }

  if (normalizedTool === 'WebSearch') {
    const query = pickString(toolInput, ['query', 'q']) || '';
    return query ? `WebSearch:${query.substring(0, 30)}` : 'WebSearch';
  }

  // Default: normalized tool name
  return normalizedTool;
}

function normalizeToolName(toolName: string): string {
  const lower = toolName.toLowerCase();
  if (['bash', 'execute_command', 'run_terminal_cmd', 'terminal', 'shell'].includes(lower)) return 'Bash';
  if (lower === 'read') return 'Read';
  if (['write', 'create'].includes(lower)) return 'Write';
  if (['edit', 'patch'].includes(lower)) return 'Edit';
  if (['grep', 'search', 'find'].includes(lower)) return 'Grep';
  if (['websearch', 'web_search'].includes(lower)) return 'WebSearch';
  if (['task', 'subagent', 'delegate'].includes(lower)) return 'Task';
  return toolName;
}

function pickString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) return undefined;
  for (const k of keys) {
    const value = input[k];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickBoolean(input: Record<string, unknown> | undefined, keys: string[]): boolean | undefined {
  if (!input) return undefined;
  for (const k of keys) {
    const value = input[k];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function extractCommand(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const direct = pickString(input, ['command', 'cmd', 'commandLine']);
  if (direct) return direct;

  const args = input.args;
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const nested = pickString(args as Record<string, unknown>, ['command', 'cmd']);
    if (nested) return nested;
  }
  return undefined;
}

function extractFilePath(input: Record<string, unknown> | undefined): string | undefined {
  return pickString(input, ['file_path', 'filePath', 'path', 'target']);
}

/**
 * Detect repeating tool call patterns (e.g. Read → Grep → Read → Grep...)
 */
export function detectLoop(toolCalls: string[]): { detected: boolean; pattern?: string } {
  if (toolCalls.length < 6) return { detected: false };

  // Check periods of length 2-4, requiring at least 3 consecutive repetitions
  for (let period = 2; period <= 4; period++) {
    if (toolCalls.length < period * 3) continue;

    const tail = toolCalls.slice(-period);
    let repeats = 0;

    for (let i = toolCalls.length - period; i >= period; i -= period) {
      const segment = toolCalls.slice(i - period, i);
      if (segment.every((t, j) => t === tail[j])) repeats++;
      else break;
    }

    if (repeats >= 2) {
      // Guard: repeated sequences of *different* Bash/Task sub-signatures are often
      // legitimate workflows, not stuck loops (major false-positive source).
      const allBash = tail.every((t) => t.startsWith('Bash:'));
      const allTask = tail.every((t) => t.startsWith('Task:'));
      const unique = new Set(tail).size;
      if ((allBash || allTask) && unique > 1) {
        continue;
      }
      return { detected: true, pattern: tail.join(' → ') };
    }
  }

  return { detected: false };
}
