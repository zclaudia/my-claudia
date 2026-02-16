/**
 * Server-side E2E encryption utilities
 *
 * Generates an ephemeral RSA-OAEP keypair at startup.
 * The public key is shared with clients via /api/server/info.
 * Clients encrypt sensitive data (sudo passwords, credentials) with the public key.
 * Only this server can decrypt using the private key.
 *
 * This protects credentials even when traffic passes through a Gateway intermediary.
 */
import * as crypto from 'crypto';

interface KeyPair {
  publicKey: string;   // PEM-encoded SPKI public key
  privateKey: crypto.KeyObject;
}

let keyPair: KeyPair | null = null;

/**
 * Generate an ephemeral RSA-OAEP keypair (2048-bit).
 * Called once at server startup. The keypair lives only in memory.
 */
export function generateKeyPair(): void {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  keyPair = {
    publicKey,
    privateKey: crypto.createPrivateKey(privateKey),
  };

  console.log('[Crypto] Generated ephemeral RSA-OAEP keypair (2048-bit)');
}

/**
 * Get the PEM-encoded public key for sharing with clients.
 */
export function getPublicKeyPem(): string | null {
  return keyPair?.publicKey || null;
}

/**
 * Decrypt data that was encrypted by the client using Web Crypto RSA-OAEP.
 *
 * @param encryptedBase64 - Base64-encoded ciphertext from client
 * @returns Decrypted plaintext string
 */
export function decryptCredential(encryptedBase64: string): string {
  if (!keyPair) {
    throw new Error('Keypair not initialized. Call generateKeyPair() first.');
  }

  const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');

  const decrypted = crypto.privateDecrypt(
    {
      key: keyPair.privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    encryptedBuffer,
  );

  return decrypted.toString('utf8');
}
