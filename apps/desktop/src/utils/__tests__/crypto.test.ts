import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encryptCredential, isEncryptionAvailable, resetKeyCache } from '../crypto.js';

describe('utils/crypto', () => {
  // Mock Web Crypto API
  const mockSubtle = {
    importKey: vi.fn(),
    encrypt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetKeyCache();

    // Setup crypto mock
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        subtle: mockSubtle,
      },
      writable: true,
    });
  });

  describe('isEncryptionAvailable', () => {
    it('returns true for valid PEM string', () => {
      const pem = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----';
      expect(isEncryptionAvailable(pem)).toBe(true);
    });

    it('returns false for undefined', () => {
      expect(isEncryptionAvailable(undefined)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isEncryptionAvailable(null)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isEncryptionAvailable('')).toBe(false);
    });

    it('returns false for invalid string', () => {
      expect(isEncryptionAvailable('not a pem')).toBe(false);
    });

    it('returns false for string without BEGIN PUBLIC KEY', () => {
      expect(isEncryptionAvailable('some random text')).toBe(false);
    });
  });

  describe('encryptCredential', () => {
    it('imports key and encrypts plaintext', async () => {
      const mockKey = {} as CryptoKey;
      const mockEncrypted = new ArrayBuffer(64);
      const mockEncryptedBytes = new Uint8Array(mockEncrypted);
      mockEncryptedBytes.fill(65); // Fill with 'A' for predictable base64

      mockSubtle.importKey.mockResolvedValue(mockKey);
      mockSubtle.encrypt.mockResolvedValue(mockEncrypted);

      const pem = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----';
      const result = await encryptCredential('my-secret-password', pem);

      expect(mockSubtle.importKey).toHaveBeenCalledWith(
        'spki',
        expect.any(ArrayBuffer),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt']
      );

      const encryptCall = mockSubtle.encrypt.mock.calls[0];
      expect(encryptCall[0]).toEqual({ name: 'RSA-OAEP' });
      expect(encryptCall[1]).toBe(mockKey);
      expect(encryptCall[2].constructor.name).toBe('Uint8Array');

      expect(typeof result).toBe('string');
    });

    it('caches imported public key', async () => {
      const mockKey = {} as CryptoKey;
      mockSubtle.importKey.mockResolvedValue(mockKey);
      mockSubtle.encrypt.mockResolvedValue(new ArrayBuffer(64));

      const pem = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----';

      await encryptCredential('secret1', pem);
      await encryptCredential('secret2', pem);

      // importKey should only be called once due to caching
      expect(mockSubtle.importKey).toHaveBeenCalledTimes(1);
    });

    it('re-imports key when PEM changes', async () => {
      const mockKey = {} as CryptoKey;
      mockSubtle.importKey.mockResolvedValue(mockKey);
      mockSubtle.encrypt.mockResolvedValue(new ArrayBuffer(64));

      const pem1 = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----';
      const pem2 = '-----BEGIN PUBLIC KEY-----\nMIIDDTCCAfWg\n-----END PUBLIC KEY-----';

      await encryptCredential('secret1', pem1);
      await encryptCredential('secret2', pem2);

      expect(mockSubtle.importKey).toHaveBeenCalledTimes(2);
    });

    it('strips PEM headers correctly', async () => {
      const mockKey = {} as CryptoKey;
      mockSubtle.importKey.mockResolvedValue(mockKey);
      mockSubtle.encrypt.mockResolvedValue(new ArrayBuffer(64));

      const pem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA
-----END PUBLIC KEY-----`;

      await encryptCredential('test', pem);

      const importCall = mockSubtle.importKey.mock.calls[0];
      const buffer = importCall[1] as ArrayBuffer;

      expect(buffer).toBeInstanceOf(ArrayBuffer);
      expect(buffer.byteLength).toBeGreaterThan(0);
    });
  });
});
