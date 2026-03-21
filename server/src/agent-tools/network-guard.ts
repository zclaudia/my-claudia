/**
 * Network guard — blocks requests to private/internal addresses (SSRF protection).
 */

/**
 * Check if a hostname is a private/internal address that should be blocked.
 * Covers RFC 1918, RFC 4193, loopback, and link-local addresses.
 */
export function isPrivateAddress(hostname: string): boolean {
  // Exact blocked hosts
  const blockedExact = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '[::1]',
    '::1',
  ]);
  if (blockedExact.has(hostname)) return true;

  // IPv4 private ranges
  if (hostname.startsWith('10.')) return true;           // 10.0.0.0/8
  if (hostname.startsWith('192.168.')) return true;      // 192.168.0.0/16
  if (hostname.startsWith('169.254.')) return true;      // Link-local

  // 172.16.0.0 - 172.31.255.255 (RFC 1918)
  if (hostname.startsWith('172.')) {
    const second = parseInt(hostname.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  // 127.x.x.x loopback range
  if (hostname.startsWith('127.')) return true;

  // IPv6 private/internal (stripped of brackets)
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (bare.startsWith('fe80:')) return true;             // Link-local
  if (bare.startsWith('fc') || bare.startsWith('fd')) return true;  // RFC 4193 unique-local
  if (bare === '::1') return true;                       // Loopback
  if (bare === '::') return true;                        // Unspecified

  return false;
}
