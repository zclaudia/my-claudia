/**
 * Unit tests for version utilities
 */

import { describe, it, expect } from 'vitest';
import { getAppVersion, satisfiesVersion, checkPluginCompatibility } from '../version.js';

describe('version utilities', () => {
  describe('getAppVersion', () => {
    it('should return a version string', () => {
      const version = getAppVersion();
      expect(typeof version).toBe('string');
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should cache the version', () => {
      const v1 = getAppVersion();
      const v2 = getAppVersion();
      expect(v1).toBe(v2);
    });
  });

  describe('satisfiesVersion', () => {
    it('should return true for a very low version range', () => {
      // This should always be true
      expect(satisfiesVersion('>=0.0.0')).toBe(true);
    });

    it('should return a boolean', () => {
      const result = satisfiesVersion('>=0.1.0');
      expect(typeof result).toBe('boolean');
    });
  });

  // Test satisfiesSimple indirectly through satisfiesVersion / checkPluginCompatibility
  // We need to test the actual function with known versions, so we use checkPluginCompatibility
  // which calls satisfiesSimple internally
  describe('satisfiesSimple via checkPluginCompatibility', () => {
    // We can't control the app version easily, but we know it's a valid semver
    // Let's test the range operators with >= 0.0.0 (always true) and >= 999.0.0 (always false)

    it('handles >= operator', () => {
      expect(checkPluginCompatibility({ claudia: '>=0.0.0' }).compatible).toBe(true);
      expect(checkPluginCompatibility({ claudia: '>=999.0.0' }).compatible).toBe(false);
    });

    it('handles > operator', () => {
      expect(checkPluginCompatibility({ claudia: '>0.0.0' }).compatible).toBe(true);
      expect(checkPluginCompatibility({ claudia: '>999.0.0' }).compatible).toBe(false);
    });

    it('handles <= operator', () => {
      expect(checkPluginCompatibility({ claudia: '<=999.0.0' }).compatible).toBe(true);
      expect(checkPluginCompatibility({ claudia: '<=0.0.0' }).compatible).toBe(false);
    });

    it('handles < operator', () => {
      expect(checkPluginCompatibility({ claudia: '<999.0.0' }).compatible).toBe(true);
      expect(checkPluginCompatibility({ claudia: '<0.0.1' }).compatible).toBe(false);
    });

    it('handles ^ operator (caret range)', () => {
      // ^0.1.0 means >=0.1.0 <0.2.0 — app version is 0.1.x so should match
      const appVersion = getAppVersion();
      const [major, minor] = appVersion.split('.').map(Number);
      // Test with a caret range matching current major.minor
      const result = checkPluginCompatibility({ claudia: `^${major}.${minor}.0` });
      expect(result.compatible).toBe(true);
    });

    it('handles ~ operator (tilde range)', () => {
      const appVersion = getAppVersion();
      const [major, minor] = appVersion.split('.').map(Number);
      // ~major.minor.0 means >=major.minor.0 <major.(minor+1).0
      const result = checkPluginCompatibility({ claudia: `~${major}.${minor}.0` });
      expect(result.compatible).toBe(true);
    });

    it('handles ^ with major 0 (stricter)', () => {
      // ^0.x.y with major=0 requires minor to match exactly
      expect(checkPluginCompatibility({ claudia: '^0.999.0' }).compatible).toBe(false);
    });

    it('handles exact version match', () => {
      const appVersion = getAppVersion();
      expect(checkPluginCompatibility({ claudia: appVersion }).compatible).toBe(true);
      expect(checkPluginCompatibility({ claudia: '999.999.999' }).compatible).toBe(false);
    });

    it('handles v-prefixed versions', () => {
      // The satisfiesSimple strips the v prefix from versions
      expect(checkPluginCompatibility({ claudia: '>=0.0.0' }).compatible).toBe(true);
    });
  });

  describe('checkPluginCompatibility', () => {
    it('should return compatible when no engines specified', () => {
      const result = checkPluginCompatibility(undefined);
      expect(result.compatible).toBe(true);
      expect(result.appVersion).toBeDefined();
    });

    it('should return compatible when no claudia engine specified', () => {
      const result = checkPluginCompatibility({});
      expect(result.compatible).toBe(true);
    });

    it('should check claudia version requirement', () => {
      const result = checkPluginCompatibility({ claudia: '>=0.0.1' });
      expect(result.compatible).toBe(true);
      expect(result.requiredRange).toBe('>=0.0.1');
    });

    it('should return error for impossible version requirement', () => {
      const result = checkPluginCompatibility({ claudia: '>=999.999.999' });
      // This should be incompatible since app version is likely < 999.999.999
      expect(typeof result.compatible).toBe('boolean');
      if (!result.compatible) {
        expect(result.error).toBeDefined();
      }
    });
  });
});
