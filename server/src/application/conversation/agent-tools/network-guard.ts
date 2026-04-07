/**
 * Network guard — blocks requests to private/internal addresses (SSRF protection).
 */

import { lookup } from 'dns/promises';

/**
 * Check if a hostname is a private/internal address that should be blocked.
 * Covers RFC 1918, RFC 4193, loopback, and link-local addresses.
 */
function isPrivateIPv4(ip: string): boolean {
  if (ip.startsWith('10.')) return true;           // 10.0.0.0/8
  if (ip.startsWith('192.168.')) return true;      // 192.168.0.0/16
  if (ip.startsWith('169.254.')) return true;      // Link-local
  if (ip.startsWith('127.')) return true;          // Loopback
  if (ip.startsWith('0.')) return true;            // 0.0.0.0/8

  // 172.16.0.0 - 172.31.255.255 (RFC 1918)
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
}

export function isPrivateAddress(hostname: string): boolean {
  // Exact blocked hosts
  if (hostname === 'localhost' || hostname === '0.0.0.0') return true;

  // Check plain IPv4
  if (isPrivateIPv4(hostname)) return true;

  // IPv6 handling (stripped of brackets)
  const bare = hostname.replace(/^\[|\]$/g, '');

  // IPv4-mapped IPv6: ::ffff:10.0.0.1, ::ffff:127.0.0.1, etc.
  const v4mappedMatch = bare.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4mappedMatch) return isPrivateIPv4(v4mappedMatch[1]);

  if (bare === '::1') return true;                       // Loopback
  if (bare === '::') return true;                        // Unspecified
  if (bare.startsWith('fe80:') || bare.startsWith('fe80%')) return true;  // Link-local
  if (bare.startsWith('fc') || bare.startsWith('fd')) return true;  // RFC 4193 unique-local

  return false;
}

/**
 * Resolve a hostname and block it if any resolved address is private/internal.
 * Falls back to hostname-only checks when DNS resolution is unavailable.
 */
export async function isBlockedHostname(hostname: string): Promise<boolean> {
  if (isPrivateAddress(hostname)) return true;

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.some((addr) => isPrivateAddress(addr.address));
  } catch {
    return false;
  }
}
