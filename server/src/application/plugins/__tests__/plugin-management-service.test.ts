import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginManagementError, PluginManagementService } from '../management-service.js';

describe('PluginManagementService', () => {
  const loader = {
    getPlugins: vi.fn(),
    getPlugin: vi.fn(),
    hasPlugin: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    reload: vi.fn(),
    discover: vi.fn(),
    remove: vi.fn(),
    getPluginDirs: vi.fn(),
    getExtraDirsFromDb: vi.fn(),
    saveExtraDirs: vi.fn(),
  };
  const permissions = {
    getGrantedPermissions: vi.fn(),
    grantAll: vi.fn(),
    revoke: vi.fn(),
  };
  const tools = { getByPlugin: vi.fn() };
  const commands = { getByPlugin: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists plugins with merged registry data', () => {
    loader.getPlugins.mockReturnValue([
      {
        manifest: { id: 'plugin-1', name: 'Plugin 1', version: '1.0.0', description: 'Desc', author: 'Auth', permissions: ['fs:read'] },
        isActive: true,
        error: undefined,
        pendingPermissions: [],
        path: '/plugins/plugin-1',
      },
    ]);
    permissions.getGrantedPermissions.mockReturnValue(['fs:read']);
    tools.getByPlugin.mockReturnValue([{ definition: { function: { name: 'tool-a' } } }]);
    commands.getByPlugin.mockReturnValue([{ command: '/cmd-a' }]);

    const service = new PluginManagementService({ loader: loader as never, permissions: permissions as never, tools: tools as never, commands: commands as never });
    const result = service.listPlugins();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'plugin-1',
      grantedPermissions: ['fs:read'],
      tools: ['tool-a'],
      commands: ['/cmd-a'],
    });
  });

  it('activates, reloads and removes existing plugins', async () => {
    loader.hasPlugin.mockReturnValue(true);
    loader.activate.mockResolvedValue(true);
    loader.reload.mockResolvedValue(true);
    loader.remove.mockResolvedValue(undefined);
    loader.deactivate.mockResolvedValue(undefined);

    const service = new PluginManagementService({ loader: loader as never, permissions: permissions as never, tools: tools as never, commands: commands as never });

    await expect(service.activatePlugin('plugin-1')).resolves.toEqual({ activated: true });
    await expect(service.deactivatePlugin('plugin-1')).resolves.toEqual({ deactivated: true });
    await expect(service.reloadPlugin('plugin-1')).resolves.toEqual({ reloaded: true });
    await expect(service.removePlugin('plugin-1')).resolves.toEqual({ removed: true });
  });

  it('normalizes dirs and triggers discovery', async () => {
    loader.getPluginDirs.mockReturnValue(['/plugins/default', '/extra']);
    loader.discover.mockResolvedValue([{ id: 'plugin-1', name: 'Plugin 1', version: '1.0.0' }]);
    loader.getPlugin.mockReturnValue({ isActive: false });
    loader.activate.mockResolvedValue(true);

    const service = new PluginManagementService({ loader: loader as never, permissions: permissions as never, tools: tools as never, commands: commands as never });
    const updated = service.updatePluginDirs([' /extra ', '', '/extra']);
    expect(loader.saveExtraDirs).toHaveBeenCalledWith(['/extra']);
    expect(updated).toEqual({ dirs: ['/plugins/default', '/extra'] });

    const discovered = await service.discoverPlugins();
    expect(discovered).toEqual({
      discovered: 1,
      plugins: [{ id: 'plugin-1', name: 'Plugin 1', version: '1.0.0' }],
    });
  });

  it('throws structured validation errors', () => {
    loader.hasPlugin.mockReturnValue(false);
    const service = new PluginManagementService({ loader: loader as never, permissions: permissions as never, tools: tools as never, commands: commands as never });

    expect(() => service.grantPermissions('plugin-1', 'fs:read')).toThrowError(PluginManagementError);
    expect(() => service.updatePluginDirs('bad')).toThrowError(PluginManagementError);
  });
});
