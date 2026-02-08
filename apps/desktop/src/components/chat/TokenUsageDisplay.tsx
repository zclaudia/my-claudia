interface TokenUsageDisplayProps {
  inputTokens: number;
  outputTokens: number;
}

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(0)}K`;
  }
  return String(count);
}

export function TokenUsageDisplay({ inputTokens, outputTokens }: TokenUsageDisplayProps) {
  const total = inputTokens + outputTokens;

  if (total === 0) return null;

  // Context window thresholds (rough estimate based on typical limits)
  const MAX_CONTEXT = 200_000;
  const ratio = inputTokens / MAX_CONTEXT;
  const colorClass = ratio > 0.8
    ? 'text-destructive'
    : ratio > 0.6
    ? 'text-yellow-500'
    : 'text-muted-foreground';

  return (
    <div className={`flex items-center gap-1 text-xs ${colorClass}`} title={`Input: ${inputTokens.toLocaleString()} | Output: ${outputTokens.toLocaleString()}`}>
      <span>{formatTokenCount(inputTokens)}/{formatTokenCount(MAX_CONTEXT)}</span>
    </div>
  );
}
