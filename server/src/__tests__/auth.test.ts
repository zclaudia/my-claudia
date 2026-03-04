import { describe, it, expect } from 'vitest';
import { safeCompare } from '../auth.js';

describe('safeCompare', () => {
  describe('时序安全比较', () => {
    it('对相同字符串返回 true', () => {
      expect(safeCompare('test', 'test')).toBe(true);
    });

    it('对不同字符串返回 false', () => {
      expect(safeCompare('test1', 'test2')).toBe(false);
    });

    it('对不同长度字符串返回 false', () => {
      expect(safeCompare('test', 'testing')).toBe(false);
    });

    it('对相同长度的不同字符串返回 false', () => {
      expect(safeCompare('abcd', 'abce')).toBe(false);
    });
  });

  describe('输入验证', () => {
    it('对非字符串第一参数返回 false', () => {
      expect(safeCompare(null as any, 'test')).toBe(false);
    });

    it('对非字符串第二参数返回 false', () => {
      expect(safeCompare('test', undefined as any)).toBe(false);
    });

    it('对两个非字符串参数返回 false', () => {
      expect(safeCompare(123 as any, 456 as any)).toBe(false);
    });

    it('对 null 参数返回 false', () => {
      expect(safeCompare(null as any, null as any)).toBe(false);
    });

    it('对 undefined 参数返回 false', () => {
      expect(safeCompare(undefined as any, undefined as any)).toBe(false);
    });

    it('对数字参数返回 false', () => {
      expect(safeCompare(123 as any, '123')).toBe(false);
    });

    it('对对象参数返回 false', () => {
      expect(safeCompare({} as any, 'test')).toBe(false);
    });

    it('对数组参数返回 false', () => {
      expect(safeCompare([] as any, 'test')).toBe(false);
    });
  });

  describe('边界情况', () => {
    it('处理空字符串', () => {
      expect(safeCompare('', '')).toBe(true);
    });

    it('处理空字符串与非空字符串', () => {
      expect(safeCompare('', 'test')).toBe(false);
    });

    it('处理单字符字符串', () => {
      expect(safeCompare('a', 'a')).toBe(true);
      expect(safeCompare('a', 'b')).toBe(false);
    });

    it('处理长字符串', () => {
      const longString = 'a'.repeat(10000);
      expect(safeCompare(longString, longString)).toBe(true);
      expect(safeCompare(longString, longString + 'b')).toBe(false);
    });
  });

  describe('Unicode 和特殊字符', () => {
    it('处理 Unicode 字符串', () => {
      expect(safeCompare('🔥', '🔥')).toBe(true);
      expect(safeCompare('🔥', '💧')).toBe(false);
    });

    it('处理多字节 Unicode 字符', () => {
      expect(safeCompare('你好', '你好')).toBe(true);
      expect(safeCompare('你好', '世界')).toBe(false);
    });

    it('处理 emoji', () => {
      expect(safeCompare('😀🎉', '😀🎉')).toBe(true);
      expect(safeCompare('😀🎉', '😀😊')).toBe(false);
    });

    it('处理特殊字符', () => {
      expect(safeCompare('test\n', 'test\n')).toBe(true);
      expect(safeCompare('test\n', 'test')).toBe(false);
    });

    it('处理 null 字符', () => {
      expect(safeCompare('test\0', 'test\0')).toBe(true);
      expect(safeCompare('test\0', 'test')).toBe(false);
    });

    it('处理制表符', () => {
      expect(safeCompare('\t\t', '\t\t')).toBe(true);
      expect(safeCompare('\t\t', '\t ')).toBe(false);
    });

    it('处理回车换行', () => {
      expect(safeCompare('\r\n', '\r\n')).toBe(true);
      expect(safeCompare('\r\n', '\n')).toBe(false);
    });
  });

  describe('安全性特性', () => {
    it('长度不匹配时仍执行比较以保持常量时间', () => {
      // 这个测试验证长度不匹配时仍然调用 timingSafeEqual
      // 我们无法直接测试时间，但可以验证函数不会抛出错误
      expect(() => safeCompare('short', 'longer')).not.toThrow();
      expect(safeCompare('short', 'longer')).toBe(false);
    });

    it('对非常相似的字符串返回 false', () => {
      expect(safeCompare('test1', 'test2')).toBe(false);
      expect(safeCompare('abc', 'abd')).toBe(false);
      expect(safeCompare('12345', '12346')).toBe(false);
    });

    it('对完全相同的引用返回 true', () => {
      const str = 'test-string';
      expect(safeCompare(str, str)).toBe(true);
    });
  });

  describe('典型用例', () => {
    it('验证 API key 场景', () => {
      const validKey = 'sk-1234567890abcdef';
      const providedKey = 'sk-1234567890abcdef';
      const invalidKey = 'sk-0987654321fedcba';

      expect(safeCompare(validKey, providedKey)).toBe(true);
      expect(safeCompare(validKey, invalidKey)).toBe(false);
    });

    it('验证 token 场景', () => {
      const token1 = 'Bearer abc123xyz789';
      const token2 = 'Bearer abc123xyz789';
      const token3 = 'Bearer different';

      expect(safeCompare(token1, token2)).toBe(true);
      expect(safeCompare(token1, token3)).toBe(false);
    });

    it('验证 secret 场景', () => {
      const secret = 'my-super-secret-password-123';
      expect(safeCompare(secret, 'my-super-secret-password-123')).toBe(true);
      expect(safeCompare(secret, 'wrong-secret')).toBe(false);
    });
  });

  describe('Buffer 行为', () => {
    it('正确处理 UTF-8 编码', () => {
      const utf8String = 'Hello 世界 🌍';
      expect(safeCompare(utf8String, utf8String)).toBe(true);
    });

    it('处理 ASCII 字符串', () => {
      expect(safeCompare('ASCII only', 'ASCII only')).toBe(true);
      expect(safeCompare('ASCII only', 'ASCII onlY')).toBe(false);
    });

    it('大小写敏感', () => {
      expect(safeCompare('Test', 'test')).toBe(false);
      expect(safeCompare('TEST', 'test')).toBe(false);
      expect(safeCompare('Test', 'Test')).toBe(true);
    });
  });
});
