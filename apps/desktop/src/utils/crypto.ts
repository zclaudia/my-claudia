/**
 * Client-side E2E encryption utilities
 *
 * Uses Web Crypto API (SubtleCrypto) to encrypt sensitive data
 * with the server's RSA-OAEP public key.
 *
 * Flow:
 * 1. Client fetches server's public key PEM from /api/server/info
 * 2. Client imports the PEM as a CryptoKey
 * 3. Client encrypts credentials (sudo password, API keys, etc.)
 * 4. Ciphertext is sent as base64 — only the server can decrypt
 */

let cachedPublicKey: CryptoKey | null = null;
let cachedPem: string | null = null;

/**
 * Convert a PEM-encoded SPKI public key to a Web Crypto CryptoKey.
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  // Use cached key if PEM hasn't changed
  if (cachedPem === pem && cachedPublicKey) {
    return cachedPublicKey;
  }

  // Strip PEM header/footer and decode base64
  const pemBody = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'spki',
    binaryDer.buffer,
    {
      name: 'RSA-OAEP',
      hash: 'SHA-256',
    },
    false, // not extractable
    ['encrypt'],
  );

  cachedPublicKey = key;
  cachedPem = pem;
  return key;
}

/**
 * Encrypt a plaintext string using the server's RSA-OAEP public key.
 *
 * @param plaintext - The sensitive string to encrypt (e.g. sudo password)
 * @param publicKeyPem - PEM-encoded SPKI public key from server
 * @returns Base64-encoded ciphertext
 */
export async function encryptCredential(plaintext: string, publicKeyPem: string): Promise<string> {
  const key = await importPublicKey(publicKeyPem);

  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    encoded,
  );

  // Convert ArrayBuffer to base64
  const bytes = new Uint8Array(encrypted);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Check if the server supports E2E encryption (has a public key).
 */
export function isEncryptionAvailable(publicKeyPem: string | undefined | null): boolean {
  return typeof publicKeyPem === 'string' && publicKeyPem.includes('BEGIN PUBLIC KEY');
}
