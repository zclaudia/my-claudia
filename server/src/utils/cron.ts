import { CronExpressionParser } from 'cron-parser';

/**
 * Compute the next run timestamp from a cron expression.
 * @param cronExpr Standard 5-field cron expression (minute hour day month weekday)
 * @param fromDate Epoch ms to compute from (defaults to now)
 * @returns Next run timestamp in epoch ms
 */
export function computeNextCronRun(cronExpr: string, fromDate?: number): number {
  const expr = CronExpressionParser.parse(cronExpr, {
    currentDate: fromDate ? new Date(fromDate) : new Date(),
  });
  return expr.next().toDate().getTime();
}

/**
 * Validate a cron expression.
 * @returns true if the expression is valid
 */
export function isValidCron(cronExpr: string): boolean {
  try {
    CronExpressionParser.parse(cronExpr);
    return true;
  } catch {
    return false;
  }
}
