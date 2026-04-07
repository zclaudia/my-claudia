import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createExpressAuthMiddleware } from '../express-auth.js';

vi.mock('../local-only.js', () => ({
  isLocalhost: vi.fn(() => false),
}));

import { isLocalhost } from '../local-only.js';

function createResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('createExpressAuthMiddleware', () => {
  it('allows localhost requests without bearer auth', () => {
    vi.mocked(isLocalhost).mockReturnValue(true);
    const middleware = createExpressAuthMiddleware(() => false);
    const req = { headers: {} } as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts known client ids for remote requests', () => {
    vi.mocked(isLocalhost).mockReturnValue(false);
    const middleware = createExpressAuthMiddleware((token) => token === 'client-123');
    const req = {
      headers: { authorization: 'Bearer client-123' },
    } as unknown as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects unknown bearer tokens for remote requests', () => {
    vi.mocked(isLocalhost).mockReturnValue(false);
    const middleware = createExpressAuthMiddleware(() => false);
    const req = {
      headers: { authorization: 'Bearer gateway-secret' },
    } as unknown as Request;
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' }
    });
  });
});
