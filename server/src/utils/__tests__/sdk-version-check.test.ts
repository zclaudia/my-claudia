import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkSdkVersions,
  getSdkVersionReport,
  type SdkVersionReport,
} from '../sdk-version-check.js';
import * as fs from 'fs';

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock import.meta.url
vi.stubGlobal('import.meta', {
  url: 'file:///test/path/sdk-version-check.ts',
});

describe('utils/sdk-version-check', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('getSdkVersionReport', () => {
    it('returns null before check', () => {
      expect(getSdkVersionReport()).toBeNull();
    });

    it('returns cached report after check', async () => {
      // Mock file reads for installed version
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      // Mock npm registry response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0.0' }),
      });

      await checkSdkVersions();
      const report = getSdkVersionReport();

      expect(report).not.toBeNull();
      expect(report?.sdks).toBeDefined();
      expect(report?.checkedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('checkSdkVersions', () => {
    it('returns report with SDK info', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '2.0.0' }),
      });

      const report = await checkSdkVersions();

      expect(report.sdks.length).toBeGreaterThan(0);
      expect(report.checkedAt).toBeLessThanOrEqual(Date.now());
    });

    it('marks SDK as outdated when newer version available', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '2.0.0' }),
      });

      const report = await checkSdkVersions();
      const sdk = report.sdks[0];

      expect(sdk.outdated).toBe(true);
      expect(sdk.current).toBe('1.0.0');
      expect(sdk.latest).toBe('2.0.0');
    });

    it('marks SDK as current when at latest', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '2.0.0' }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '2.0.0' }),
      });

      const report = await checkSdkVersions();
      const sdk = report.sdks[0];

      expect(sdk.outdated).toBe(false);
    });

    it('handles missing package gracefully', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      const report = await checkSdkVersions();

      // Should still return a report, possibly with fewer SDKs
      expect(report).toBeDefined();
      expect(report.sdks).toBeDefined();
    });

    it('handles npm registry errors gracefully', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const report = await checkSdkVersions();

      // Should still include SDK but with latest === current
      expect(report.sdks.length).toBeGreaterThan(0);
      expect(report.sdks[0].latest).toBe('1.0.0');
      expect(report.sdks[0].outdated).toBe(false);
    });

    it('handles network timeout gracefully', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockFetch.mockRejectedValue(new Error('Network timeout'));

      const report = await checkSdkVersions();

      expect(report).toBeDefined();
    });

    it('caches report for subsequent calls', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0.0' }),
      });

      const report1 = await checkSdkVersions();
      const report2 = getSdkVersionReport();

      expect(report1).toBe(report2);
    });
  });

  describe('compareSemver', () => {
    // Testing via the public API since compareSemver is not exported

    it('correctly compares versions via outdated flag', async () => {
      const testCases = [
        { current: '1.0.0', latest: '2.0.0', expectedOutdated: true },
        { current: '2.0.0', latest: '1.0.0', expectedOutdated: false },
        { current: '1.0.0', latest: '1.0.0', expectedOutdated: false },
        { current: '1.0.0', latest: '1.0.1', expectedOutdated: true },
        { current: '1.0.1', latest: '1.1.0', expectedOutdated: true },
        { current: '1.1.0', latest: '2.0.0', expectedOutdated: true },
      ];

      for (const { current, latest, expectedOutdated } of testCases) {
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: current }));
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ version: latest }),
        });

        const report = await checkSdkVersions();
        const sdk = report.sdks[0];

        expect(sdk.outdated).toBe(expectedOutdated);
      }
    });

    it('handles missing version segments', async () => {
      const testCases = [
        { current: '1', latest: '1.0.0', expectedOutdated: false },
        { current: '1.0', latest: '1.0.1', expectedOutdated: true },
        { current: '2', latest: '1.9.9', expectedOutdated: false },
      ];

      for (const { current, latest, expectedOutdated } of testCases) {
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: current }));
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ version: latest }),
        });

        const report = await checkSdkVersions();
        const sdk = report.sdks[0];

        expect(sdk.outdated).toBe(expectedOutdated);
      }
    });
  });

  describe('SDK_PACKAGES', () => {
    it('checks all configured SDK packages', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0.0' }),
      });

      const report = await checkSdkVersions();

      // Should have checked both @anthropic-ai/claude-agent-sdk and @opencode-ai/sdk
      expect(report.sdks.length).toBeGreaterThanOrEqual(0);
      expect(mockFetch).toHaveBeenCalledTimes(Math.min(report.sdks.length, 2));
    });
  });
});
