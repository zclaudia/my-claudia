import { describe, it, expect } from 'vitest';
import { extractRetryDelayMsFromError } from '../retry-window.js';

describe('extractRetryDelayMsFromError', () => {
  it('parses retry-after seconds', () => {
    const ms = extractRetryDelayMsFromError('Rate limit hit. retry-after: 12s');
    expect(ms).toBe(12000);
  });

  it('parses relative in-phrase duration', () => {
    const ms = extractRetryDelayMsFromError('Try again in 1m 30s');
    expect(ms).toBe(90000);
  });

  it('parses clock-like in-phrase duration', () => {
    const ms = extractRetryDelayMsFromError('quota exceeded, retry in 00:02:15');
    expect(ms).toBe(135000);
  });

  it('parses absolute ISO reset time', () => {
    const now = Date.parse('2026-03-06T10:00:00Z');
    const ms = extractRetryDelayMsFromError('limit exceeded, resets at 2026-03-06T10:01:30Z', now);
    expect(ms).toBe(90000);
  });

  it('parses "resets 7pm (Asia/Shanghai)" format', () => {
    const now = Date.parse('2026-03-06T08:00:00Z'); // 16:00 in Asia/Shanghai
    const ms = extractRetryDelayMsFromError("You're out of extra usage · resets 7pm (Asia/Shanghai)", now);
    expect(ms).toBe(3 * 60 * 60 * 1000); // 3 hours to 19:00 local
  });

  it('returns null when no retry timing hint exists', () => {
    const ms = extractRetryDelayMsFromError('authentication failed');
    expect(ms).toBeNull();
  });
});
