import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TokenUsageDisplay } from '../TokenUsageDisplay';

describe('TokenUsageDisplay', () => {
  it('returns null when all tokens are 0', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={0} outputTokens={0} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders token counts', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={1500} outputTokens={500} />
    );
    expect(container.textContent).toContain('2K/--');
  });

  it('formats millions', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={1500000} outputTokens={0} />
    );
    expect(container.textContent).toContain('1.5M');
  });

  it('shows context window ratio', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={80000} outputTokens={0} contextWindow={100000} />
    );
    expect(container.textContent).toContain('80K/100K');
  });

  it('applies destructive class when ratio > 0.8', () => {
    const { container } = render(
      <TokenUsageDisplay inputTokens={90000} outputTokens={0} contextWindow={100000} />
    );
    expect(container.innerHTML).toContain('text-destructive');
  });

  it('uses latestInputTokens when provided', () => {
    const { container } = render(
      <TokenUsageDisplay
        inputTokens={5000}
        outputTokens={1000}
        latestInputTokens={2000}
        latestOutputTokens={500}
      />
    );
    expect(container.textContent).toContain('2K/--');
  });
});
