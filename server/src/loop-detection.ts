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
  // For Bash commands, include the command name (first word)
  if (toolName === 'Bash' && toolInput?.command && typeof toolInput.command === 'string') {
    const cmd = toolInput.command.split(' ')[0];
    return `Bash:${cmd}`;
  }

  // For Read/Write/Edit, include file path with parent directory for better disambiguation
  if (['Read', 'Write', 'Edit'].includes(toolName) && toolInput?.file_path && typeof toolInput.file_path === 'string') {
    const parts = toolInput.file_path.split('/');
    // Include last 2 parts of path (parent dir + filename) for better disambiguation
    // e.g., "src/config.json" instead of just "config.json"
    const pathSignature = parts.length >= 2
      ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      : parts[parts.length - 1] || toolInput.file_path;
    return `${toolName}:${pathSignature}`;
  }

  // For Grep, include the pattern
  if (toolName === 'Grep' && toolInput?.pattern && typeof toolInput.pattern === 'string') {
    const pattern = toolInput.pattern.substring(0, 20);
    return `Grep:${pattern}`;
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
      return { detected: true, pattern: tail.join(' → ') };
    }
  }

  return { detected: false };
}
