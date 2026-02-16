import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { generateKeyPair, getPublicKeyPem, decryptCredential } from '../crypto.js';

/**
 * Encrypt a plaintext string using the public key (simulates what the browser client does
 * with Web Crypto RSA-OAEP). Returns a base64-encoded ciphertext.
 */
function encryptWithPublicKey(publicKeyPem: string, plaintext: string): string {
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(plaintext, 'utf8'),
  );
  return encrypted.toString('base64');
}

describe('crypto', () => {
  beforeEach(() => {
    // Generate a fresh keypair for each test to avoid cross-test state leakage
    generateKeyPair();
  });

  describe('generateKeyPair', () => {
    it('makes getPublicKeyPem return a PEM-encoded public key', () => {
      const pem = getPublicKeyPem();
      expect(pem).toBeTruthy();
      expect(pem!).toContain('-----BEGIN PUBLIC KEY-----');
      expect(pem!).toContain('-----END PUBLIC KEY-----');
    });

    it('generates a new keypair each time it is called', () => {
      const pem1 = getPublicKeyPem();
      generateKeyPair();
      const pem2 = getPublicKeyPem();

      // Two different RSA key generations should produce different keys
      // (astronomically unlikely to collide)
      expect(pem1).not.toBe(pem2);
    });
  });

  describe('encrypt + decrypt roundtrip', () => {
    it('round-trips a short string', () => {
      const publicKey = getPublicKeyPem()!;
      const plaintext = 'my-secret-password';
      const encrypted = encryptWithPublicKey(publicKey, plaintext);
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const publicKey = getPublicKeyPem()!;
      const plaintext = '';
      const encrypted = encryptWithPublicKey(publicKey, plaintext);
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips a string with special characters', () => {
      const publicKey = getPublicKeyPem()!;
      const plaintext = 'p@$$w0rd!#%^&*()_+={}\n\ttab "quotes" \'single\'';
      const encrypted = encryptWithPublicKey(publicKey, plaintext);
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('round-trips unicode content', () => {
      const publicKey = getPublicKeyPem()!;
      const plaintext = 'Hello  Bonjour';
      const encrypted = encryptWithPublicKey(publicKey, plaintext);
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('handles various input lengths up to the RSA limit', () => {
      const publicKey = getPublicKeyPem()!;

      // RSA-OAEP with SHA-256 and 2048-bit key can encrypt up to:
      //   256 - 2*32 - 2 = 190 bytes
      const lengths = [1, 10, 50, 100, 150, 190];
      for (const len of lengths) {
        const plaintext = 'x'.repeat(len);
        const encrypted = encryptWithPublicKey(publicKey, plaintext);
        const decrypted = decryptCredential(encrypted);
        expect(decrypted).toBe(plaintext);
      }
    });
  });

  describe('decryptCredential error cases', () => {
    it('throws if given invalid base64 / ciphertext', () => {
      expect(() => decryptCredential('not-valid-ciphertext-at-all')).toThrow();
    });

    it('throws if ciphertext was encrypted with a different key', () => {
      const publicKey1 = getPublicKeyPem()!;
      const encrypted = encryptWithPublicKey(publicKey1, 'secret');

      // Generate a completely new keypair -- old ciphertext should not decrypt
      generateKeyPair();

      expect(() => decryptCredential(encrypted)).toThrow();
    });
  });
});
