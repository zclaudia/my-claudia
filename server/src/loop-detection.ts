/**
 * Loop detection utilities for tool calls
 */

/**
 * Generate a specific signature for a tool call to improve loop detection granularity
 */
export function generateToolSignature(
  toolName: string,
  toolInput?: Record<string, unknown>
): string {
  // For Bash commands, include a richer command signature (command + key subcommand).
  if (toolName === 'Bash' && toolInput?.command && typeof toolInput.command === 'string') {
    const raw = toolInput.command.trim().replace(/\s+/g, ' ');
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

  // For Read/Write/Edit, include file path with parent directory for better disambiguation
  if (['Read', 'Write', 'Edit'].includes(toolName) && toolInput?.file_path && typeof toolInput.file_path === 'string') {
    const parts = toolInput.file_path.split('/');
    // Include last 2 parts of path (parent dir + filename) for better disambiguation
    // e.g., "src/config.json" instead of just "config.json"
    const pathSignature = parts.length > 3
      ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      : parts[parts.length - 1] || toolInput.file_path;
    return `${toolName}:${pathSignature}`;
  }

  // For Grep, include pattern + path hint when available.
  if (toolName === 'Grep' && toolInput?.pattern && typeof toolInput.pattern === 'string') {
    const pattern = toolInput.pattern.substring(0, 30);
    const path = typeof toolInput.path === 'string' ? toolInput.path.split('/').slice(-2).join('/') : '';
    return path ? `Grep:${pattern}@${path}` : `Grep:${pattern}`;
  }

  // Default: just use tool name
  return toolName;
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
      // Guard: repeated sequences of *different* Bash subcommands are often legitimate
      // command workflows, not stuck loops (high false-positive source).
      const allBash = tail.every((t) => t.startsWith('Bash:'));
      const unique = new Set(tail).size;
      if (allBash && unique > 1) {
        continue;
      }
      return { detected: true, pattern: tail.join(' → ') };
    }
  }

  return { detected: false };
}
