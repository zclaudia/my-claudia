import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    connectServer: vi.fn(),
  }),
}));

import { MobileSetup } from '../MobileSetup';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useMobileRecoveryStore } from '../../stores/mobileRecoveryStore';
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
      snapshotVersion: 0,
    });

    useServerStore.setState((state) => ({
      ...state,
      activeServerId: null,
    }));

    useRecoveryStore.setState((state) => ({
      ...state,
      transport: {
        ...state.transport,
        status: 'idle',
        error: null,
      },
      backends: {},
      dataSyncs: {},
    }));
    useMobileRecoveryStore.getState().reset();
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
      useRecoveryStore.setState((state) => ({
        ...state,
        transport: {
          ...state.transport,
          status: 'error',
          error: 'UNAUTHORIZED: Invalid gateway secret',
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('UNAUTHORIZED: Invalid gateway secret')).toBeInTheDocument();
    });
  });

  it('renders the mobile debug panel when mobileDebug=1 is present', () => {
    window.history.replaceState({}, '', '/?mobileDebug=1');

    useGatewayStore.setState({
      showLocalBackend: false,
    } as any);

    useFacadeStore.setState({
      connectionState: 'connected',
      connectionError: null,
      currentInstanceId: 'inst-mobile',
      backends: [
        {
          backendId: 'backend-1',
          name: 'Backend 1',
          online: true,
          runtimeState: 'visible',
          openState: 'closed',
          channelId: null,
          instanceId: 'inst-remote',
          deviceId: 'dev-remote',
          channel: 'prod',
          isThisInstance: false,
          isThisDevice: false,
          capabilities: [],
        },
      ],
    } as any);

    render(<MobileSetup />);

    expect(screen.getByTestId('mobile-debug-panel')).toBeInTheDocument();
    expect(screen.getByText('backends: 1')).toBeInTheDocument();
    expect(screen.getByText(/Backend 1 \(backend-1\)/)).toBeInTheDocument();

    window.history.replaceState({}, '', '/');
  });

  it('toggles the mobile debug panel after tapping the logo five times', () => {
    useGatewayStore.setState({
      showLocalBackend: false,
    } as any);

    useFacadeStore.setState({
      connectionState: 'connected',
      connectionError: null,
      currentInstanceId: 'inst-mobile',
      backends: [
        {
          backendId: 'backend-1',
          name: 'Backend 1',
          online: true,
          runtimeState: 'visible',
          openState: 'closed',
          channelId: null,
          instanceId: 'inst-remote',
          deviceId: 'dev-remote',
          channel: 'prod',
          isThisInstance: false,
          isThisDevice: false,
          capabilities: [],
        },
      ],
    } as any);

    render(<MobileSetup />);

    expect(screen.queryByTestId('mobile-debug-panel')).not.toBeInTheDocument();

    const logoButton = screen.getByRole('button', { name: '' });
    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(logoButton);
    }

    expect(screen.getByTestId('mobile-debug-panel')).toBeInTheDocument();
  });

  it('keeps setup form visible while mobile recovery is running', () => {
    useFacadeStore.setState({
      connectionState: 'connected',
      connectionError: null,
      backends: [
        {
          backendId: 'backend-1',
          name: 'Backend 1',
          online: true,
          runtimeState: 'ready',
          openState: 'open',
          channelId: 'ch-1',
          instanceId: 'inst-remote',
          deviceId: 'dev-remote',
          channel: 'prod',
          isThisInstance: false,
          isThisDevice: false,
          capabilities: [],
        },
      ],
    } as any);
    useMobileRecoveryStore.setState({ phase: 'recovering' } as any);

    render(<MobileSetup />);

    expect(screen.getByText('MyClaudia')).toBeInTheDocument();
    expect(screen.queryByText('Select a Server')).not.toBeInTheDocument();
  });
});
