import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AppError,
  errorHandlingMiddleware,
  validationErrorMiddleware,
  dbErrorMiddleware,
} from '../error.js';
import { errorResponse } from '../base.js';

// Mock errorResponse
vi.mock('../base.js', () => ({
  errorResponse: vi.fn(),
}));

describe('AppError', () => {
  it('创建带 code 和 message 的错误', () => {
    const error = new AppError('TEST_CODE', 'Test message');

    expect(error.code).toBe('TEST_CODE');
    expect(error.message).toBe('Test message');
    expect(error.name).toBe('AppError');
    expect(error).toBeInstanceOf(Error);
  });

  it('包含可选的 details', () => {
    const error = new AppError('TEST_CODE', 'Test', { field: 'value', count: 42 });

    expect(error.details).toEqual({ field: 'value', count: 42 });
  });

  it('允许 details 为 undefined', () => {
    const error = new AppError('TEST_CODE', 'Test');

    expect(error.details).toBeUndefined();
  });

  it('允许各种类型的 details', () => {
    const error1 = new AppError('CODE', 'Test', 'string details');
    const error2 = new AppError('CODE', 'Test', [1, 2, 3]);
    const error3 = new AppError('CODE', 'Test', new Error('inner'));

    expect(error1.details).toBe('string details');
    expect(error2.details).toEqual([1, 2, 3]);
    expect(error3.details).toBeInstanceOf(Error);
  });
});

describe('errorHandlingMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCtx = {
      request: { type: 'test-request' },
    };

    mockNext = vi.fn();

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('AppError 处理', () => {
    it('捕获 AppError 并返回格式化错误响应', async () => {
      const appError = new AppError('NOT_FOUND', 'Resource not found', { id: 123 });
      mockNext.mockRejectedValue(appError);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'NOT_FOUND',
        'Resource not found',
        { id: 123 }
      );
      expect(result).toBe('error-response');
    });

    it('记录错误到控制台', async () => {
      const appError = new AppError('TEST_CODE', 'Test error');
      mockNext.mockRejectedValue(appError);

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[ErrorMiddleware] Error processing test-request:',
        appError
      );
    });

    it('处理无 details 的 AppError', async () => {
      const appError = new AppError('TEST_CODE', 'Test error');
      mockNext.mockRejectedValue(appError);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'TEST_CODE',
        'Test error',
        undefined
      );
    });
  });

  describe('通用 Error 处理', () => {
    it('处理标准 Error 对象', async () => {
      const error = new Error('Something went wrong');
      mockNext.mockRejectedValue(error);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'Something went wrong'
      );
      expect(result).toBe('error-response');
    });

    it('从 error.code 提取错误代码', async () => {
      const error: any = new Error('Custom error');
      error.code = 'CUSTOM_CODE';
      mockNext.mockRejectedValue(error);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'CUSTOM_CODE',
        'Custom error'
      );
      expect(result).toBe('error-response');
    });

    it('通用错误默认为 INTERNAL_ERROR', async () => {
      const error = new Error('Generic error');
      mockNext.mockRejectedValue(error);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        expect.anything(),
        'INTERNAL_ERROR',
        expect.anything()
      );
    });

    it('记录通用错误', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('未知错误类型', () => {
    it('处理字符串错误', async () => {
      mockNext.mockRejectedValue('Something failed');
      vi.mocked(errorResponse).mockReturnValue('error-response');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: 'Something failed' }
      );
      expect(result).toBe('error-response');
    });

    it('处理对象错误', async () => {
      const errorObj = { reason: 'unknown', code: 500 };
      mockNext.mockRejectedValue(errorObj);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: String(errorObj) }
      );
      expect(result).toBe('error-response');
    });

    it('处理 null 错误', async () => {
      mockNext.mockRejectedValue(null);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: 'null' }
      );
      expect(result).toBe('error-response');
    });

    it('处理 undefined 错误', async () => {
      mockNext.mockRejectedValue(undefined);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: 'undefined' }
      );
      expect(result).toBe('error-response');
    });

    it('处理数字错误', async () => {
      mockNext.mockRejectedValue(42);
      vi.mocked(errorResponse).mockReturnValue('error-response');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: '42' }
      );
      expect(result).toBe('error-response');
    });
  });

  describe('成功路径', () => {
    it('无错误时正常通过', async () => {
      mockNext.mockResolvedValue('success-result');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(result).toBe('success-result');
      expect(errorResponse).not.toHaveBeenCalled();
    });

    it('返回 next() 的结果', async () => {
      const expectedResult = { data: 'test' };
      mockNext.mockResolvedValue(expectedResult);

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(result).toBe(expectedResult);
    });

    it('成功路径不记录错误', async () => {
      mockNext.mockResolvedValue('success');

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});

describe('validationErrorMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCtx = {
      request: { type: 'test-request' },
    };

    mockNext = vi.fn();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('捕获 VALIDATION_ERROR AppError', async () => {
    const validationError = new AppError('VALIDATION_ERROR', 'Name is required', {
      field: 'name',
    });
    mockNext.mockRejectedValue(validationError);
    vi.mocked(errorResponse).mockReturnValue('validation-response');

    const result = await validationErrorMiddleware(mockCtx, mockNext);

    expect(errorResponse).toHaveBeenCalledWith(
      mockCtx.request,
      'VALIDATION_ERROR',
      'Name is required',
      { field: 'name' }
    );
    expect(result).toBe('validation-response');
  });

  it('记录验证错误到控制台', async () => {
    const validationError = new AppError('VALIDATION_ERROR', 'Invalid input', {
      field: 'email',
    });
    mockNext.mockRejectedValue(validationError);

    await validationErrorMiddleware(mockCtx, mockNext);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[ValidationError] Invalid input',
      { field: 'email' }
    );
  });

  it('重新抛出非验证错误', async () => {
    const otherError = new AppError('OTHER_CODE', 'Other error');
    mockNext.mockRejectedValue(otherError);

    await expect(validationErrorMiddleware(mockCtx, mockNext)).rejects.toThrow(otherError);
  });

  it('重新抛出通用 Error', async () => {
    const genericError = new Error('Generic error');
    mockNext.mockRejectedValue(genericError);

    await expect(validationErrorMiddleware(mockCtx, mockNext)).rejects.toThrow(genericError);
  });

  it('允许成功请求通过', async () => {
    mockNext.mockResolvedValue('success');

    const result = await validationErrorMiddleware(mockCtx, mockNext);

    expect(result).toBe('success');
    expect(errorResponse).not.toHaveBeenCalled();
  });
});

describe('dbErrorMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCtx = {
      request: { type: 'test-request' },
    };

    mockNext = vi.fn();
  });

  describe('UNIQUE 约束', () => {
    it('处理 UNIQUE 约束违规', async () => {
      const dbError = new Error('UNIQUE constraint failed: users.email');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue('duplicate-response');

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'DUPLICATE_ERROR',
        'A record with this information already exists',
        { originalError: 'UNIQUE constraint failed: users.email' }
      );
      expect(result).toBe('duplicate-response');
    });

    it('检测 UNIQUE constraint (大小写不敏感)', async () => {
      const dbError = new Error('unique constraint violation');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue('error');

      await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        expect.anything(),
        'DUPLICATE_ERROR',
        expect.anything()
      );
    });
  });

  describe('FOREIGN KEY 约束', () => {
    it('处理 FOREIGN KEY 约束违规', async () => {
      const dbError = new Error('FOREIGN KEY constraint failed');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue('reference-response');

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'REFERENCE_ERROR',
        'Cannot perform this operation due to existing references',
        { originalError: 'FOREIGN KEY constraint failed' }
      );
      expect(result).toBe('reference-response');
    });

    it('检测 FOREIGN KEY constraint (大小写不敏感)', async () => {
      const dbError = new Error('foreign key constraint violation');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue('error');

      await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        expect.anything(),
        'REFERENCE_ERROR',
        expect.anything()
      );
    });
  });

  describe('数据库访问错误', () => {
    it('处理数据库锁定错误', async () => {
      const dbError = new Error('database is locked');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue('db-error-response');

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'DATABASE_ERROR',
        'Database error occurred',
        { originalError: 'database is locked' }
      );
      expect(result).toBe('db-error-response');
    });

    it('处理表不存在错误', async () => {
      const dbError = new Error('no such table: users');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue('db-error-response');

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'DATABASE_ERROR',
        'Database error occurred',
        { originalError: 'no such table: users' }
      );
      expect(result).toBe('db-error-response');
    });
  });

  describe('错误传播', () => {
    it('重新抛出非数据库错误', async () => {
      const genericError = new Error('Some other error');
      mockNext.mockRejectedValue(genericError);

      await expect(dbErrorMiddleware(mockCtx, mockNext)).rejects.toThrow(genericError);
    });

    it('重新抛出 AppError', async () => {
      const appError = new AppError('NOT_FOUND', 'Not found');
      mockNext.mockRejectedValue(appError);

      await expect(dbErrorMiddleware(mockCtx, mockNext)).rejects.toThrow(appError);
    });

    it('重新抛出非 Error 对象', async () => {
      mockNext.mockRejectedValue('string error');

      await expect(dbErrorMiddleware(mockCtx, mockNext)).rejects.toBe('string error');
    });
  });

  describe('成功路径', () => {
    it('允许成功请求通过', async () => {
      mockNext.mockResolvedValue('success');

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(result).toBe('success');
      expect(errorResponse).not.toHaveBeenCalled();
    });
  });
});
