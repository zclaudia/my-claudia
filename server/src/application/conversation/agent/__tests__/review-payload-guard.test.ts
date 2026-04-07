import { describe, it, expect } from 'vitest';
import { guardReviewFileContent, guardReviewText } from '../review-payload-guard.js';

describe('review-payload-guard', () => {
  it('redacts bearer tokens in review text', () => {
    const result = guardReviewText('curl https://api.example.com -H "Authorization: Bearer secret-token-1234567890"');
    expect(result.disposition).toBe('send_with_redaction');
    expect(result.text).toContain('[REDACTED_TOKEN]');
    expect(result.text).not.toContain('secret-token-1234567890');
  });

  it('blocks known sensitive file paths', () => {
    const result = guardReviewFileContent('/workspace/.env', 'API_TOKEN=test');
    expect(result.disposition).toBe('do_not_send');
  });

  it('blocks commands that dump environment variables', () => {
    const result = guardReviewText('printenv');
    expect(result.disposition).toBe('do_not_send');
  });

  it('leaves ordinary code untouched', () => {
    const result = guardReviewFileContent('/workspace/scripts/deploy.sh', 'echo deploy\nnpm test\n');
    expect(result.disposition).toBe('safe_to_send');
    expect(result.redactionCount).toBe(0);
  });
});
