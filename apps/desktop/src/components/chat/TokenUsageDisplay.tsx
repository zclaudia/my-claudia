interface TokenUsageDisplayProps {
  latestInputTokens?: number;
  latestOutputTokens?: number;
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
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

export function TokenUsageDisplay({
  latestInputTokens,
  latestOutputTokens,
  inputTokens,
  outputTokens,
  contextWindow
}: TokenUsageDisplayProps) {
  const total = inputTokens + outputTokens;
  const currentInput = latestInputTokens ?? inputTokens;
  const currentOutput = latestOutputTokens ?? outputTokens;
  const currentTotal = currentInput + currentOutput;

  if (total === 0 && currentTotal === 0) return null;

  const hasContextWindow = typeof contextWindow === 'number' && contextWindow > 0;
  const ratio = hasContextWindow ? (currentInput / contextWindow) : 0;
  const colorClass = !hasContextWindow
    ? 'text-muted-foreground'
    : ratio > 0.8
      ? 'text-destructive'
      : ratio > 0.6
        ? 'text-yellow-500'
        : 'text-muted-foreground';

  const valueText = hasContextWindow
    ? `${formatTokenCount(currentInput)}/${formatTokenCount(contextWindow)}`
    : `${formatTokenCount(currentInput)}/--`;

  return (
    <div
      className={`flex items-center gap-1 text-xs ${colorClass}`}
      title={`Current: ${currentInput.toLocaleString()} in / ${currentOutput.toLocaleString()} out | Total: ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out | Context: ${hasContextWindow ? contextWindow.toLocaleString() : 'unknown'}`}
    >
      <span>{valueText}</span>
    </div>
  );
}
