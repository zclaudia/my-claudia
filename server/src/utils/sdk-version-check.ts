import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface SdkVersionInfo {
  name: string;
  current: string;
  latest: string;
  outdated: boolean;
}

export interface SdkVersionReport {
  checkedAt: number;
  sdks: SdkVersionInfo[];
}

/** SDK packages to monitor for updates. */
const SDK_PACKAGES = [
  '@anthropic-ai/claude-agent-sdk',
  '@opencode-ai/sdk',
];

/** Module-level cached report, set after checkSdkVersions() completes. */
let cachedReport: SdkVersionReport | null = null;

/** Get the cached SDK version report (null if check hasn't completed yet). */
export function getSdkVersionReport(): SdkVersionReport | null {
  return cachedReport;
}

/**
 * Check installed SDK versions against npm registry latest versions.
 * Non-blocking, fails silently — never affects server startup.
 * Caches the result for later retrieval via getSdkVersionReport().
 */
export async function checkSdkVersions(): Promise<SdkVersionReport> {
  const sdks = await Promise.all(
    SDK_PACKAGES.map(pkg => checkSingleSdk(pkg)),
  );

  const report: SdkVersionReport = {
    checkedAt: Date.now(),
    sdks: sdks.filter((s): s is SdkVersionInfo => s !== null),
  };
  cachedReport = report;
  return report;
}

async function checkSingleSdk(name: string): Promise<SdkVersionInfo | null> {
  try {
    // Read installed version from node_modules
    const current = await getInstalledVersion(name);
    if (!current) return null;

    // Query npm registry for latest version
    const latest = await fetchLatestVersion(name);
    if (!latest) return { name, current, latest: current, outdated: false };

    return {
      name,
      current,
      latest,
      outdated: compareSemver(current, latest) < 0,
    };
  } catch {
    return null;
  }
}

async function getInstalledVersion(pkg: string): Promise<string | null> {
  try {
    // Resolve from server package's node_modules
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const serverRoot = path.resolve(thisDir, '..', '..');
    const pkgJsonPath = path.join(serverRoot, 'node_modules', ...pkg.split('/'), 'package.json');
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    return pkgJson.version || null;
  } catch {
    // Try createRequire as fallback (pnpm hoisting)
    try {
      const { createRequire } = await import('module');
      const req = createRequire(import.meta.url);
      const resolved = req.resolve(`${pkg}/package.json`);
      const pkgJson = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      return pkgJson.version || null;
    } catch {
      return null;
    }
  }
}

async function fetchLatestVersion(pkg: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(pkg).replace('%40', '@')}/latest`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return null;
    const data = await response.json() as { version?: string };
    return data.version || null;
  } catch {
    return null;
  }
}

/** Simple semver comparison: returns -1 if a < b, 0 if equal, 1 if a > b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}
