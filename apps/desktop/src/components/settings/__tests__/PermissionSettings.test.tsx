import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PermissionSettings } from '../PermissionSettings';
import { useProviderMetaStore } from '../../../stores/providerMetaStore';
import { useServerStore } from '../../../stores/serverStore';

const mockGetAgentConfig = vi.fn();
const mockUpdateAgentConfig = vi.fn();
const mockListAllWorkflows = vi.fn();
const mockGetProviderCapabilities = vi.fn();

vi.mock('../../../services/api/servers', () => ({
  getAgentConfig: (...args: unknown[]) => mockGetAgentConfig(...args),
  updateAgentConfig: (...args: unknown[]) => mockUpdateAgentConfig(...args),
}));

vi.mock('../../../features/workflows/api', () => ({
  listAllWorkflows: (...args: unknown[]) => mockListAllWorkflows(...args),
}));

vi.mock('../../../services/api/providers', () => ({
  getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args),
}));

describe('PermissionSettings', () => {
  beforeEach(() => {
    mockGetAgentConfig.mockReset();
    mockUpdateAgentConfig.mockReset();
    mockListAllWorkflows.mockReset();
    mockGetProviderCapabilities.mockReset();

    useServerStore.setState({ activeServerId: 'local' } as any);
    useProviderMetaStore.setState({
      providersByBackend: {
        local: [
          {
            id: 'prov-supported',
            name: 'Claude',
            type: 'claude',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          {
            id: 'prov-unsupported',
            name: 'Legacy',
            type: 'claude',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      },
    } as any);

    mockGetAgentConfig.mockResolvedValue({
      id: 1,
      enabled: true,
      projectId: null,
      sessionId: null,
      providerId: null,
      permissionWorkflowOverrideId: null,
      permissionPolicy: JSON.stringify({
        enabled: true,
        aiReview: {
          enabled: true,
        },
      }),
    });
    mockUpdateAgentConfig.mockResolvedValue({
      id: 1,
      enabled: true,
      projectId: null,
      sessionId: null,
      providerId: null,
      permissionWorkflowOverrideId: null,
      permissionPolicy: null,
    });
    mockListAllWorkflows.mockResolvedValue([]);

    mockGetProviderCapabilities.mockImplementation(async (providerId: string) => ({
      modes: [],
      models: [],
      supportsCliJobs: providerId === 'prov-supported',
    }));
  });

  it('only lists providers that support cli-jobs for AI review', async () => {
    render(<PermissionSettings />);

    await screen.findByText('Review provider');

    await waitFor(() => {
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith('prov-supported');
      expect(mockGetProviderCapabilities).toHaveBeenCalledWith('prov-unsupported');
    });

    expect(screen.getByRole('option', { name: 'Session default' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude (claude)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Legacy (claude)' })).toBeNull();
  });

  it('lists non-system workflows as global override options', async () => {
    mockListAllWorkflows.mockResolvedValue([
      { id: 'wf-global', name: 'Global Review', status: 'active', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } },
      { id: 'wf-system', name: 'System Fallback', status: 'active', isSystem: true, definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } },
      { id: 'wf-disabled', name: 'Disabled Review', status: 'disabled', definition: { nodes: [], edges: [], entryNodeId: '', triggers: [] } },
    ]);

    render(<PermissionSettings />);

    expect(await screen.findByText('Global override')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '[Global] Global Review' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '[Global] System Fallback' })).toBeNull();
    expect(screen.queryByRole('option', { name: '[Global] Disabled Review' })).toBeNull();
  });
});
