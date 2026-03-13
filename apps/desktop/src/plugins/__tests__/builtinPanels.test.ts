import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';

describe('initBuiltinPanels', () => {
  beforeEach(() => {
    usePluginStore.setState({
      panels: [],
    } as any);
  });

  it('registers system-monitor and notes-board panels', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    // Re-import to get fresh module
    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    expect(registerSpy).toHaveBeenCalledTimes(2);
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'system-monitor', pluginId: 'com.claudia.system-monitor' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notes-board', pluginId: 'com.claudia.notes-board' })
    );
  });
});
