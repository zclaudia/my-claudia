import { describe, it, expect, vi } from 'vitest';
import { PluginFrontendError, PluginFrontendService } from '../../application/plugins/frontend-service.js';

describe('PluginFrontendService', () => {
  it('resolves frontend files within plugin directory', () => {
    const loader = {
      getPlugin: vi.fn().mockReturnValue({ path: '/plugins/test-plugin' }),
    };
    const service = new PluginFrontendService({
      loader: loader as never,
      pathExists: vi.fn().mockReturnValue(true),
    });

    const fullPath = service.resolveFrontendFile('test-plugin', 'dist/index.html');

    expect(fullPath).toBe('/plugins/test-plugin/dist/index.html');
  });

  it('rejects invalid plugin ids and missing plugins', () => {
    const service = new PluginFrontendService({
      loader: { getPlugin: vi.fn().mockReturnValue(undefined) } as never,
      pathExists: vi.fn(),
    });

    expect(() => service.resolveFrontendFile('bad plugin', 'index.html')).toThrowError(PluginFrontendError);
    expect(() => service.resolveFrontendFile('missing', 'index.html')).toThrowError('Plugin not found');
  });

  it('rejects missing files and traversal outside plugin root', () => {
    const loader = {
      getPlugin: vi.fn().mockReturnValue({ path: '/plugins/test-plugin' }),
    };
    const service = new PluginFrontendService({
      loader: loader as never,
      pathExists: vi.fn().mockReturnValue(false),
    });

    expect(() => service.resolveFrontendFile('test-plugin', '../etc/passwd')).toThrowError('Forbidden');
    expect(() => service.resolveFrontendFile('test-plugin', 'missing.html')).toThrowError('File not found');
  });
});
