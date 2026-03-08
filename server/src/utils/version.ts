/**
 * Version utilities for compatibility checking
 */

// Read version from package.json at build time
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let _appVersion: string | null = null;

/**
 * Get the application version from package.json
 */
export function getAppVersion(): string {
  if (_appVersion !== null) return _appVersion;

  try {
    const pkgPath = require.resolve('@my-claudia/server/package.json');
    const pkg = require(pkgPath);
    _appVersion = pkg.version || '0.1.0';
  } catch {
    _appVersion = '0.1.0';
  }

  // TypeScript flow doesn't narrow the type correctly, so we use non-null assertion
  return _appVersion!;
}

/**
 * Simple semver comparison
 * Supports formats like: >=0.1.0, ^0.1.0, ~0.1.0, >0.1.0, etc.
 */
function satisfiesSimple(version: string, range: string): boolean {
  // Clean the version
  const cleanVersion = version.replace(/^v/, '').split('-')[0];
  const [major, minor = 0, patch = 0] = cleanVersion.split('.').map(Number);

  // Parse range
  const cleanRange = range.trim();

  // Handle different operators
  if (cleanRange.startsWith('>=')) {
    const target = cleanRange.slice(2).trim();
    const [tMajor, tMinor = 0, tPatch = 0] = target.split('.').map(Number);
    return (
      major > tMajor ||
      (major === tMajor && minor > tMinor) ||
      (major === tMajor && minor === tMinor && patch >= tPatch)
    );
  }

  if (cleanRange.startsWith('>')) {
    const target = cleanRange.slice(1).trim();
    const [tMajor, tMinor = 0, tPatch = 0] = target.split('.').map(Number);
    return (
      major > tMajor ||
      (major === tMajor && minor > tMinor) ||
      (major === tMajor && minor === tMinor && patch > tPatch)
    );
  }

  if (cleanRange.startsWith('<=')) {
    const target = cleanRange.slice(2).trim();
    const [tMajor, tMinor = 0, tPatch = 0] = target.split('.').map(Number);
    return (
      major < tMajor ||
      (major === tMajor && minor < tMinor) ||
      (major === tMajor && minor === tMinor && patch <= tPatch)
    );
  }

  if (cleanRange.startsWith('<')) {
    const target = cleanRange.slice(1).trim();
    const [tMajor, tMinor = 0, tPatch = 0] = target.split('.').map(Number);
    return (
      major < tMajor ||
      (major === tMajor && minor < tMinor) ||
      (major === tMajor && minor === tMinor && patch < tPatch)
    );
  }

  // Handle ^ and ~ (compatible with version)
  if (cleanRange.startsWith('^') || cleanRange.startsWith('~')) {
    const target = cleanRange.slice(1).trim();
    const [tMajor, tMinor = 0, tPatch = 0] = target.split('.').map(Number);

    // Major version must match
    if (major !== tMajor) return false;

    // For ^, allow changes that do not modify the leftmost non-zero digit
    if (cleanRange.startsWith('^')) {
      if (tMajor === 0) {
        // ^0.x.y: minor must match, patch >= target
        return minor === tMinor && patch >= tPatch;
      }
      // ^x.y.z (x>0): minor/patch can increase freely
      return minor > tMinor || (minor === tMinor && patch >= tPatch);
    }

    // For ~, patch can vary but minor must match
    return minor === tMinor && patch >= tPatch;
  }

  // Exact match
  const [tMajor, tMinor = 0, tPatch = 0] = cleanRange.split('.').map(Number);
  return major === tMajor && minor === tMinor && patch === tPatch;
}

/**
 * Check if a semver range is satisfied by the current app version
 */
export function satisfiesVersion(range: string): boolean {
  const appVersion = getAppVersion();
  return satisfiesSimple(appVersion, range);
}

/**
 * Check plugin compatibility with the current app version
 */
export function checkPluginCompatibility(engines?: { claudia?: string }): {
  compatible: boolean;
  appVersion: string;
  requiredRange?: string;
  error?: string;
} {
  const appVersion = getAppVersion();

  if (!engines || !engines.claudia) {
    // No version requirement specified
    return { compatible: true, appVersion };
  }

  const requiredRange = engines.claudia;

  try {
    const compatible = satisfiesSimple(appVersion, requiredRange);
    return {
      compatible,
      appVersion,
      requiredRange,
      error: compatible ? undefined : `Plugin requires claudia ${requiredRange}, but current version is ${appVersion}`,
    };
  } catch (error) {
    return {
      compatible: false,
      appVersion,
      requiredRange,
      error: `Invalid version range: ${requiredRange}`,
    };
  }
}
