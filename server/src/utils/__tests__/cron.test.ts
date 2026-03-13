import { describe, it, expect } from 'vitest';
import { computeNextCronRun, isValidCron } from '../cron.js';

describe('cron', () => {
  describe('computeNextCronRun', () => {
    it('returns next run timestamp from a cron expression', () => {
      // Every minute
      const now = Date.now();
      const next = computeNextCronRun('* * * * *', now);
      expect(next).toBeGreaterThan(now);
      // Should be within ~60 seconds
      expect(next - now).toBeLessThanOrEqual(60_000);
    });

    it('uses current time when fromDate is not specified', () => {
      const before = Date.now();
      const next = computeNextCronRun('* * * * *');
      expect(next).toBeGreaterThanOrEqual(before);
    });

    it('computes correct next run for specific schedule', () => {
      // Jan 1 2025 00:00:00 UTC
      const fromDate = new Date('2025-01-01T00:00:00Z').getTime();
      // Every hour at minute 0
      const next = computeNextCronRun('0 * * * *', fromDate);
      // Should be Jan 1 2025 01:00:00 UTC
      expect(next).toBe(new Date('2025-01-01T01:00:00Z').getTime());
    });

    it('throws on invalid cron expression', () => {
      expect(() => computeNextCronRun('invalid')).toThrow();
    });
  });

  describe('isValidCron', () => {
    it('returns true for valid cron expressions', () => {
      expect(isValidCron('* * * * *')).toBe(true);
      expect(isValidCron('0 0 * * *')).toBe(true);
      expect(isValidCron('*/5 * * * *')).toBe(true);
      expect(isValidCron('0 9 * * 1-5')).toBe(true);
    });

    it('returns false for invalid cron expressions', () => {
      expect(isValidCron('invalid')).toBe(false);
      expect(isValidCron('not a cron')).toBe(false);
      expect(isValidCron('99 99 99 99 99')).toBe(false);
    });
  });
});
