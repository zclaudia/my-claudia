import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

describe('agent-tools/network-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks private IPv4 and IPv4-mapped IPv6 addresses', async () => {
    const { isPrivateAddress } = await import('../network-guard.js');

    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.5.4')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('[::ffff:10.0.0.8]')).toBe(true);
    expect(isPrivateAddress('fd12::1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('blocks public hostnames that resolve to private addresses', async () => {
    const dns = await import('dns/promises');
    vi.mocked(dns.lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ] as never);

    const { isBlockedHostname } = await import('../network-guard.js');

    await expect(isBlockedHostname('example.com')).resolves.toBe(true);
  });

  it('allows hostnames when DNS lookup fails after hostname-only checks', async () => {
    const dns = await import('dns/promises');
    vi.mocked(dns.lookup).mockRejectedValue(new Error('dns failure'));

    const { isBlockedHostname } = await import('../network-guard.js');

    await expect(isBlockedHostname('public.example')).resolves.toBe(false);
    await expect(isBlockedHostname('localhost')).resolves.toBe(true);
  });
});
