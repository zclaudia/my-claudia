import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Mock API
vi.mock('../../services/api', () => ({
  getServerGatewayConfig: vi.fn().mockResolvedValue({
    enabled: false,
    gatewayUrl: '',
    gatewaySecret: '',
    backendName: '',
    registerAsBackend: true,
    proxyUrl: '',
    proxyUsername: '',
    proxyPassword: '',
  }),
  updateServerGatewayConfig: vi.fn().mockResolvedValue({}),
  getServerGatewayStatus: vi.fn().mockResolvedValue({
    enabled: false,
    connected: false,
    backendId: null,
    discoveredBackends: [],
  }),
  connectServerToGateway: vi.fn().mockResolvedValue({}),
  disconnectServerFromGateway: vi.fn().mockResolvedValue({}),
}));

import { ServerGatewayConfig } from '../ServerGatewayConfig';
import { useGatewayStore } from '../../stores/gatewayStore';
import * as apiModule from '../../services/api';

describe('ServerGatewayConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useGatewayStore.setState({
      showLocalBackend: false,
      setShowLocalBackend: vi.fn(),
    } as any);
  });

  it('shows loading state initially', () => {
    const { container } = render(<ServerGatewayConfig />);
    expect(container.textContent).toContain('Loading...');
  });

  it('renders configuration form after loading', async () => {
    const { container } = render(<ServerGatewayConfig />);

    await waitFor(() => {
      expect(container.textContent).toContain('Gateway Configuration');
    });

    expect(container.textContent).toContain('Gateway URL');
    expect(container.textContent).toContain('Gateway Secret');
    expect(container.textContent).toContain('Backend Name');
    expect(container.textContent).toContain('Save Configuration');
  });

  it('shows status when loaded', async () => {
    (apiModule.getServerGatewayStatus as any).mockResolvedValue({
      enabled: false,
      connected: false,
      backendId: null,
      discoveredBackends: [],
    });

    const { container } = render(<ServerGatewayConfig />);

    await waitFor(() => {
      expect(container.textContent).toContain('Disabled');
    });
  });

  it('shows connected status and disconnect button', async () => {
    (apiModule.getServerGatewayConfig as any).mockResolvedValue({
      enabled: true,
      gatewayUrl: 'http://gateway.test',
      gatewaySecret: '********',
      backendName: 'Test',
      registerAsBackend: true,
    });
    (apiModule.getServerGatewayStatus as any).mockResolvedValue({
      enabled: true,
      connected: true,
      backendId: 'backend-123',
      discoveredBackends: [],
    });

    const { container } = render(<ServerGatewayConfig />);

    await waitFor(() => {
      expect(container.textContent).toContain('Connected');
    });

    expect(container.textContent).toContain('backend-123');
    expect(container.textContent).toContain('Disconnect');
  });

  it('shows proxy fields when proxy URL is entered', async () => {
    const { container } = render(<ServerGatewayConfig />);

    await waitFor(() => {
      expect(container.textContent).toContain('Gateway Configuration');
    });

    // Enter a proxy URL
    const proxyInput = container.querySelector('[data-testid="proxy-url-input"]') as HTMLInputElement;
    expect(proxyInput).toBeTruthy();
    fireEvent.change(proxyInput, { target: { value: 'socks5://127.0.0.1:1080' } });

    // Should now show proxy username/password fields
    await waitFor(() => {
      expect(container.querySelector('[data-testid="proxy-username-input"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="proxy-password-input"]')).toBeTruthy();
    });
  });

  it('calls save API when save button is clicked', async () => {
    const { container } = render(<ServerGatewayConfig />);

    await waitFor(() => {
      expect(container.textContent).toContain('Save Configuration');
    });

    // Mock alert
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const saveButton = container.querySelector('[data-testid="save-gateway-config"]')!;
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiModule.updateServerGatewayConfig).toHaveBeenCalled();
    });

    alertSpy.mockRestore();
  });
});
