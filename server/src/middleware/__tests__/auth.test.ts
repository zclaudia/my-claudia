import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from '@my-claudia/shared';
import { authMiddleware, optionalAuthMiddleware } from '../auth.js';
import { errorResponse } from '../base.js';

// Mock errorResponse
vi.mock('../base.js', () => ({
  errorResponse: vi.fn(),
}));

function createMockErrorResponse(): Response<null> {
  return {
    id: 'mock-id',
    type: 'test.response',
    payload: null,
    timestamp: 0,
    metadata: {
      requestId: 'mock-request-id',
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please provide a valid API key.',
      },
    },
  };
}

describe('authMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn().mockResolvedValue('next-result');
    mockCtx = {
      client: {
        isLocal: false,
        authenticated: false,
      },
      request: { type: 'test-request' },
    };
  });

  describe('本地客户端认证', () => {
    it('允许本地客户端无需认证访问', async () => {
      mockCtx.client.isLocal = true;
      mockCtx.client.authenticated = false;

      const result = await authMiddleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledWith(mockCtx);
      expect(result).toBe('next-result');
    });

    it('本地客户端跳过认证检查', async () => {
      mockCtx.client.isLocal = true;
      mockCtx.client.authenticated = false;

      await authMiddleware(mockCtx, mockNext);

      expect(errorResponse).not.toHaveBeenCalled();
    });
  });

  describe('远程客户端认证', () => {
    it('允许已认证的远程客户端', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = true;

      const result = await authMiddleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledWith(mockCtx);
      expect(result).toBe('next-result');
    });

    it('拒绝未认证的远程客户端', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = false;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await authMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'UNAUTHORIZED',
        'Authentication required. Please provide a valid API key.'
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('返回正确的错误消息', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = false;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      await authMiddleware(mockCtx, mockNext);

      const errorMessage = vi.mocked(errorResponse).mock.calls[0][2];
      expect(errorMessage).toContain('API key');
    });

    it('未认证客户端不调用 next', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = false;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      await authMiddleware(mockCtx, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('处理缺失的 client 对象', async () => {
      mockCtx.client = undefined as any;
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await authMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'UNAUTHORIZED',
        'Authentication required. Please provide a valid API key.'
      );
      expect(mockNext).not.toHaveBeenCalled();
      expect(result).toEqual(createMockErrorResponse());
    });

    it('处理 undefined authenticated 标志', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = undefined as any;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await authMiddleware(mockCtx, mockNext);

      // undefined 应被视为 falsy，因此应拒绝
      expect(errorResponse).toHaveBeenCalled();
      expect(result).toEqual(createMockErrorResponse());
    });

    it('处理 null authenticated 标志', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = null as any;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await authMiddleware(mockCtx, mockNext);

      // null 应被视为 falsy，因此应拒绝
      expect(errorResponse).toHaveBeenCalled();
      expect(result).toEqual(createMockErrorResponse());
    });
  });
});

describe('optionalAuthMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn().mockResolvedValue('next-result');
    mockCtx = {
      client: {
        isLocal: false,
        authenticated: false,
      },
      request: { type: 'test-request' },
    };
  });

  it('总是允许请求继续', async () => {
    mockCtx.client.isLocal = false;
    mockCtx.client.authenticated = false;

    const result = await optionalAuthMiddleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledWith(mockCtx);
    expect(result).toBe('next-result');
  });

  it('无论认证状态都调用 next', async () => {
    // 测试未认证
    mockCtx.client.authenticated = false;
    await optionalAuthMiddleware(mockCtx, mockNext);
    expect(mockNext).toHaveBeenCalled();

    // 重置
    mockNext.mockClear();

    // 测试已认证
    mockCtx.client.authenticated = true;
    await optionalAuthMiddleware(mockCtx, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('允许本地客户端继续', async () => {
    mockCtx.client.isLocal = true;
    mockCtx.client.authenticated = false;

    const result = await optionalAuthMiddleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledWith(mockCtx);
    expect(result).toBe('next-result');
  });

  it('允许远程已认证客户端继续', async () => {
    mockCtx.client.isLocal = false;
    mockCtx.client.authenticated = true;

    const result = await optionalAuthMiddleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledWith(mockCtx);
    expect(result).toBe('next-result');
  });

  it('不调用 errorResponse', async () => {
    await optionalAuthMiddleware(mockCtx, mockNext);

    expect(errorResponse).not.toHaveBeenCalled();
  });
});
