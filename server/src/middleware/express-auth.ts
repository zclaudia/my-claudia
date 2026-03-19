import type { Request, Response, NextFunction } from 'express';
import { safeCompare } from '../auth.js';
import { isLocalhost } from './local-only.js';

/**
 * Create Express authentication middleware for REST API.
 * Local requests are always allowed. Remote requests require gateway secret.
 */
export function createExpressAuthMiddleware(
  getGatewaySecret: () => string | null,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Local connections are always trusted
    if (isLocalhost(req)) {
      next();
      return;
    }

    // Remote connections: require gateway secret as Bearer token
    const authHeader = req.headers.authorization;
    const gatewaySecret = getGatewaySecret();
    if (authHeader?.startsWith('Bearer ') && gatewaySecret) {
      const token = authHeader.slice(7);
      // Support both plain gatewaySecret and legacy gatewaySecret:apiKey format
      const secretPart = token.includes(':') ? token.split(':')[0] : token;
      if (safeCompare(secretPart, gatewaySecret)) {
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
