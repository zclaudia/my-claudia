import { describe, it, expect } from 'vitest';
import { ICONS, getToolIcon, getFileIcon, getStatusIcon } from '../icons';

describe('icons config', () => {
  describe('ICONS object', () => {
    it('has tool icons', () => {
      expect(ICONS.tools.Read).toBeDefined();
      expect(ICONS.tools.Write).toBeDefined();
      expect(ICONS.tools.Edit).toBeDefined();
      expect(ICONS.tools.Bash).toBeDefined();
      expect(ICONS.tools.default).toBeDefined();
    });

    it('has file type icons', () => {
      expect(ICONS.fileTypes['.ts']).toBeDefined();
      expect(ICONS.fileTypes['.js']).toBeDefined();
      expect(ICONS.fileTypes.default).toBeDefined();
      expect(ICONS.fileTypes.directory).toBeDefined();
    });

    it('has status icons', () => {
      expect(ICONS.status.loading).toBeDefined();
      expect(ICONS.status.success).toBeDefined();
      expect(ICONS.status.error).toBeDefined();
      expect(ICONS.status.warning).toBeDefined();
      expect(ICONS.status.info).toBeDefined();
    });

    it('has message icons', () => {
      expect(ICONS.message.assistant).toBeDefined();
      expect(ICONS.message.user).toBeDefined();
      expect(ICONS.message.system).toBeDefined();
    });

    it('has system info icons', () => {
      expect(ICONS.systemInfo).toBeDefined();
    });
  });

  describe('getToolIcon', () => {
    it('returns icon for known tool', () => {
      expect(getToolIcon('Read')).toBe(ICONS.tools.Read);
      expect(getToolIcon('Write')).toBe(ICONS.tools.Write);
      expect(getToolIcon('Bash')).toBe(ICONS.tools.Bash);
    });

    it('returns default icon for unknown tool', () => {
      expect(getToolIcon('UnknownTool')).toBe(ICONS.tools.default);
    });
  });

  describe('getFileIcon', () => {
    it('returns icon for directory', () => {
      expect(getFileIcon('src', true)).toBe(ICONS.fileTypes.directory);
    });

    it('returns icon for known extension', () => {
      expect(getFileIcon('app.ts')).toBe(ICONS.fileTypes['.ts']);
      expect(getFileIcon('index.js')).toBe(ICONS.fileTypes['.js']);
    });

    it('returns default icon for unknown extension', () => {
      expect(getFileIcon('data.xyz')).toBe(ICONS.fileTypes.default);
    });

    it('handles files without extension', () => {
      expect(getFileIcon('Makefile')).toBe(ICONS.fileTypes.default);
    });

    it('is case insensitive for extensions', () => {
      expect(getFileIcon('App.TS')).toBe(ICONS.fileTypes['.ts']);
    });
  });

  describe('getStatusIcon', () => {
    it('returns icon for known status', () => {
      expect(getStatusIcon('success')).toBe(ICONS.status.success);
      expect(getStatusIcon('error')).toBe(ICONS.status.error);
      expect(getStatusIcon('loading')).toBe(ICONS.status.loading);
    });

    it('returns info icon for unknown status', () => {
      expect(getStatusIcon('unknown')).toBe(ICONS.status.info);
    });
  });
});
