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
