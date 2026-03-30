import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

// Mock hooks
vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    connectServer: vi.fn(),
  }),
}));
vi.mock('../../hooks/useMediaQuery', () => ({ useIsMobile: () => false }));

import { ServerSelector } from '../ServerSelector';
import { useServerStore } from '../../stores/serverStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useFacadeStore } from '../../stores/facadeStore';

describe('ServerSelector', () => {
  beforeEach(() => {
    useServerStore.setState({
      activeServerId: 'local',
      connections: {
        local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
      },
      setActiveServer: vi.fn(),
    } as any);
    useFacadeStore.setState({
      backends: [{ backendId: 'local', name: 'Local Server', online: true, isThisInstance: true } as any],
      localBackendId: 'local',
      currentInstanceId: 'inst-local',
      connectionState: 'connected',
      mode: 'embedded',
      sessionStreams: {},
      snapshotVersion: 1,
      registryRevision: 1,
    });

    useGatewayStore.setState({
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      setLastActiveBackend: vi.fn(),
      toggleBackendSubscription: vi.fn(),
      isBackendSubscribed: () => false,
      showLocalBackend: false,
    } as any);
  });

  it('renders without crashing', () => {
    const { container } = render(<ServerSelector />);
    expect(container.querySelector('[data-testid="server-selector"]')).toBeTruthy();
  });

  it('shows active server name', () => {
    const { container } = render(<ServerSelector />);
    expect(container.textContent).toContain('Local Server');
  });

  it('keeps the trigger shrinkable for long backend names', () => {
    useFacadeStore.setState({
      backends: [{
        backendId: 'local',
        name: 'Backend on zhanghai-super-long-hostname-with-extra-labels',
        online: true,
        isThisInstance: true,
      } as any],
    });

    const { container } = render(<ServerSelector />);
    const button = container.querySelector('[data-testid="server-selector"]') as HTMLButtonElement;
    const label = button.querySelector('span.text-sm') as HTMLSpanElement;
    const chevron = button.querySelector('svg') as SVGElement;

    expect(button.className).toContain('w-full');
    expect(button.className).toContain('min-w-0');
    expect(label.className).toContain('flex-1');
    expect(label.className).toContain('min-w-0');
    expect(label.className).toContain('truncate');
    expect(chevron.getAttribute('class')).toContain('flex-shrink-0');
  });

  it('opens dropdown when clicked', () => {
    const { container } = render(<ServerSelector />);
    const button = container.querySelector('[data-testid="server-selector"]')!;
    fireEvent.click(button);

    // Should show connection status in dropdown
    const statusEl = container.querySelector('[data-testid="connection-status"]');
    expect(statusEl).toBeTruthy();
    expect(statusEl!.textContent).toBe('Connected');
  });

  it('shows "No Server" when no active server', () => {
    useServerStore.setState({
      activeServerId: null,
    } as any);
    useFacadeStore.setState({
      backends: [],
      localBackendId: null,
      currentInstanceId: null,
    });

    const { container } = render(<ServerSelector />);
    expect(container.textContent).toContain('No Server');
  });

  it('shows gateway section with "Configure in Settings" when not configured', () => {
    const { container } = render(<ServerSelector />);
    const button = container.querySelector('[data-testid="server-selector"]')!;
    fireEvent.click(button);

    expect(container.textContent).toContain('Configure in Settings');
  });

  it('shows connecting status', () => {
    useServerStore.setState({
      connections: {
        local: { status: 'connecting', error: null, isLocalConnection: true, features: [] },
      },
    } as any);

    const { container } = render(<ServerSelector />);
    const button = container.querySelector('[data-testid="server-selector"]')!;
    fireEvent.click(button);

    const statusEl = container.querySelector('[data-testid="connection-status"]');
    expect(statusEl!.textContent).toBe('Connecting...');
  });

  it('uses fallback backend connection state when activeServerId is stale', () => {
    useServerStore.setState({
      activeServerId: 'legacy-local',
      connections: {
        'legacy-local': { status: 'error', error: 'stale', isLocalConnection: true, features: [] },
        local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
      },
    } as any);

    const { container } = render(<ServerSelector />);
    const button = container.querySelector('[data-testid="server-selector"]')!;
    fireEvent.click(button);

    const statusEl = container.querySelector('[data-testid="connection-status"]');
    expect(statusEl!.textContent).toBe('Connected');
    expect(container.textContent).toContain('Local Server');
  });
});
