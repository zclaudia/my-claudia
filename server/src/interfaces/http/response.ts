import type { Response } from 'express';

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({
    success: false,
    error: details === undefined
      ? { code, message }
      : { code, message, details },
  });
}
