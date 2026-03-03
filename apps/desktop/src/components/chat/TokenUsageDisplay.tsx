interface TokenUsageDisplayProps {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
}

const DEFAULT_CONTEXT = 200_000;

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(0)}K`;
  }
  return String(count);
}

export function TokenUsageDisplay({ inputTokens, outputTokens, contextWindow }: TokenUsageDisplayProps) {
  const total = inputTokens + outputTokens;

  if (total === 0) return null;

  const maxContext = contextWindow || DEFAULT_CONTEXT;
  const ratio = inputTokens / maxContext;
  const colorClass = ratio > 0.8
    ? 'text-destructive'
    : ratio > 0.6
    ? 'text-yellow-500'
    : 'text-muted-foreground';

  return (
    <div className={`flex items-center gap-1 text-xs ${colorClass}`} title={`Input: ${inputTokens.toLocaleString()} | Output: ${outputTokens.toLocaleString()} | Context: ${maxContext.toLocaleString()}`}>
      <span>{formatTokenCount(inputTokens)}/{formatTokenCount(maxContext)}</span>
    </div>
  );
}
