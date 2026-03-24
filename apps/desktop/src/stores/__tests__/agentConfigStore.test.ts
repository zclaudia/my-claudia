import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentConfigStore } from '../agentConfigStore';
import { getAgentConfig, updateAgentConfig } from '../../services/api/servers';

vi.mock('../../services/api/servers', () => ({
  getAgentConfig: vi.fn(),
  updateAgentConfig: vi.fn(),
}));

const mockConfig = {
  enabled: true,
  projectId: 'project-1',
  sessionId: 'session-1',
  providerId: 'provider-1',
  permissionPolicy: null,
};

describe('agentConfigStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentConfigStore.setState({
      config: null,
      isLoading: false,
      isSaving: false,
      hasLoaded: false,
      error: null,
    });
  });

  it('loads agent config into the shared store', async () => {
    vi.mocked(getAgentConfig).mockResolvedValue(mockConfig);

    await useAgentConfigStore.getState().loadConfig();

    expect(getAgentConfig).toHaveBeenCalledTimes(1);
    expect(useAgentConfigStore.getState()).toMatchObject({
      config: mockConfig,
      isLoading: false,
      hasLoaded: true,
      error: null,
    });
  });

  it('captures load failures without throwing', async () => {
    vi.mocked(getAgentConfig).mockRejectedValue(new Error('load failed'));

    await useAgentConfigStore.getState().loadConfig();

    expect(useAgentConfigStore.getState()).toMatchObject({
      config: null,
      isLoading: false,
      hasLoaded: true,
      error: 'load failed',
    });
  });

  it('updates config and returns success', async () => {
    const updatedConfig = {
      ...mockConfig,
      enabled: false,
      providerId: null,
    };
    vi.mocked(updateAgentConfig).mockResolvedValue(updatedConfig);

    const result = await useAgentConfigStore.getState().updateConfig({
      enabled: false,
      providerId: null,
    });

    expect(result).toBe(true);
    expect(updateAgentConfig).toHaveBeenCalledWith({
      enabled: false,
      providerId: null,
    });
    expect(useAgentConfigStore.getState()).toMatchObject({
      config: updatedConfig,
      isSaving: false,
      hasLoaded: true,
      error: null,
    });
  });

  it('preserves current config when update fails', async () => {
    useAgentConfigStore.setState({
      config: mockConfig,
      hasLoaded: true,
    });
    vi.mocked(updateAgentConfig).mockRejectedValue(new Error('update failed'));

    const result = await useAgentConfigStore.getState().updateConfig({
      enabled: false,
    });

    expect(result).toBe(false);
    expect(useAgentConfigStore.getState()).toMatchObject({
      config: mockConfig,
      isSaving: false,
      hasLoaded: true,
      error: 'update failed',
    });
  });
});
