import type { Request, Response, NextFunction } from 'express';
import { isLocalhost } from './local-only.js';

/**
 * Create Express authentication middleware for REST API.
 * Local requests are always allowed. Remote requests require a known clientId.
 */
export function createExpressAuthMiddleware(
  isValidClientId: (token: string) => boolean,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Local connections are always trusted
    if (isLocalhost(req)) {
      next();
      return;
    }

    // Remote connections: require a known clientId as Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (isValidClientId(token)) {
        next();
        return;
      }
    }

    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
    });
  };
}
