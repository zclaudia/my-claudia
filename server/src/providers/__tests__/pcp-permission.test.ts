import { describe, expect, it } from 'vitest';
import { CLAUDE_MANIFEST, OPENCODE_MANIFEST } from '../manifests.js';
import { negotiateProfile } from '../pcp-negotiator.js';
import { mapPermissionMode, normalizePermissionMode } from '../pcp-permission.js';

describe('pcp permission helpers', () => {
  describe('normalizePermissionMode', () => {
    it('maps legacy permission modes to PCP modes', () => {
      expect(normalizePermissionMode('default')).toBe('supervised');
      expect(normalizePermissionMode('acceptEdits')).toBe('auto_edit');
      expect(normalizePermissionMode('bypassPermissions')).toBe('autonomous');
      expect(normalizePermissionMode('plan')).toBe('plan_only');
    });

    it('returns undefined for provider-specific non-permission modes', () => {
      expect(normalizePermissionMode('sisyphus')).toBeUndefined();
      expect(normalizePermissionMode('ask')).toBeUndefined();
    });
  });

  describe('mapPermissionMode', () => {
    it('maps legacy claude modes to native manifest values', () => {
      expect(mapPermissionMode(CLAUDE_MANIFEST, 'default')).toBe('default');
      expect(mapPermissionMode(CLAUDE_MANIFEST, 'acceptEdits')).toBe('acceptEdits');
      expect(mapPermissionMode(CLAUDE_MANIFEST, 'bypassPermissions')).toBe('bypassPermissions');
      expect(mapPermissionMode(CLAUDE_MANIFEST, 'plan')).toBe('plan');
    });

    it('passes provider-specific agent names through unchanged', () => {
      expect(mapPermissionMode(OPENCODE_MANIFEST, 'sisyphus')).toBe('sisyphus');
    });
  });

  describe('negotiateProfile', () => {
    it('disables approval capability for legacy plan mode', () => {
      const profile = negotiateProfile(CLAUDE_MANIFEST, {
        mode: 'plan',
        hasMcpBridge: true,
        serverPort: 3100,
      });

      const approval = profile.capabilities.find(cap => cap.id === 'interaction.approval');
      expect(approval).toMatchObject({
        enabled: false,
        reason: 'Plan-only mode: no actions require approval',
      });
    });
  });
});
