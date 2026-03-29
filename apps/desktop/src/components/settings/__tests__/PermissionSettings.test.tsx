import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PermissionSettings } from '../PermissionSettings';
import { useProjectStore } from '../../../stores/projectStore';

const mockFetchApi = vi.fn();
const mockGetProviderCapabilities = vi.fn();

vi.mock('../../../services/api', () => ({
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));

vi.mock('../../../services/api/providers', () => ({
  getProviderCapabilities: (...args: unknown[]) => mockGetProviderCapabilities(...args),
}));

describe('PermissionSettings', () => {
  beforeEach(() => {
    mockFetchApi.mockReset();
    mockGetProviderCapabilities.mockReset();

    useProjectStore.setState({
      providers: [
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
    });

    mockFetchApi.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        enabled: true,
        permissionPolicy: JSON.stringify({
          enabled: true,
          aiReview: {
            enabled: true,
          },
        }),
      },
    });

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
});
