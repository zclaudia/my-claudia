import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';

describe('initBuiltinPanels', () => {
  beforeEach(() => {
    usePluginStore.setState({
      panels: [],
    } as any);
  });

  it('registers terminal, file-viewer, and draft panels', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    // Re-import to get fresh module
    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    expect(registerSpy).toHaveBeenCalledTimes(3);
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal', pluginId: 'com.claudia.terminal' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-viewer', pluginId: 'com.claudia.file-viewer' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'draft', pluginId: 'com.claudia.draft' })
    );
  });
});
