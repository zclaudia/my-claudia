import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    connectServer: vi.fn(),
  }),
}));

import { MobileSetup } from '../MobileSetup';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useServerStore } from '../../stores/serverStore';

describe('MobileSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useGatewayStore.setState({
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      backendAuthStatus: {},
      directGatewayUrl: null,
      directGatewaySecret: null,
      lastActiveBackendId: null,
      subscribedBackendIds: [],
      showLocalBackend: false,
    } as any);

    useFacadeStore.setState({
      facade: null,
      mode: 'direct',
      connectionState: 'idle',
      connectionError: null,
      backends: [],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      registryRevision: 0,
      snapshotVersion: 0,
    });

    useServerStore.setState((state) => ({
      ...state,
      activeServerId: null,
    }));
  });

  it('shows the real facade connection error instead of waiting for timeout', async () => {
    render(<MobileSetup />);

    fireEvent.change(screen.getByPlaceholderText('http://gateway.example.com:3200'), {
      target: { value: 'https://gateway.example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter gateway secret'), {
      target: { value: 'secret-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await act(async () => {
      useFacadeStore.setState({
        connectionState: 'error',
        connectionError: 'UNAUTHORIZED: Invalid gateway secret',
      });
    });

    expect(screen.getByText('UNAUTHORIZED: Invalid gateway secret')).toBeInTheDocument();
  });
});
