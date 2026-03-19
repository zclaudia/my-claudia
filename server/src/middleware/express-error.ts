import type { Request, Response, NextFunction } from 'express';

/** Global Express error handling middleware */
export function expressErrorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || 'Internal server error'
    }
  });
}
