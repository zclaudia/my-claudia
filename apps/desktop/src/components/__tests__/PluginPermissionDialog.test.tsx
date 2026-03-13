import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PluginPermissionDialog } from '../PluginPermissionDialog';
import { usePluginStore } from '../../stores/pluginStore';

// Mock useConnection
vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    sendMessage: vi.fn(),
  }),
}));

describe('PluginPermissionDialog', () => {
  it('returns null when no pending request', () => {
    usePluginStore.setState({ pendingPermissionRequest: null } as any);
    const { container } = render(<PluginPermissionDialog />);
    expect(container.innerHTML).toBe('');
  });

  it('renders permissions when request is pending', () => {
    usePluginStore.setState({
      pendingPermissionRequest: {
        pluginId: 'test-plugin',
        pluginName: 'Test Plugin',
        permissions: ['fs.read', 'network.fetch'],
      },
      setPendingPermissionRequest: vi.fn(),
    } as any);
    const { getByText } = render(<PluginPermissionDialog />);
    expect(getByText('Permission Request')).toBeTruthy();
    expect(getByText('Test Plugin')).toBeTruthy();
    expect(getByText('fs.read')).toBeTruthy();
    expect(getByText('network.fetch')).toBeTruthy();
  });

  it('shows danger warning for shell.execute', () => {
    usePluginStore.setState({
      pendingPermissionRequest: {
        pluginId: 'test',
        pluginName: 'Test',
        permissions: ['shell.execute'],
      },
      setPendingPermissionRequest: vi.fn(),
    } as any);
    const { getByText } = render(<PluginPermissionDialog />);
    expect(getByText('Dangerous')).toBeTruthy();
  });

  it('has Allow and Deny buttons', () => {
    usePluginStore.setState({
      pendingPermissionRequest: {
        pluginId: 'test',
        pluginName: 'Test',
        permissions: ['storage'],
      },
      setPendingPermissionRequest: vi.fn(),
    } as any);
    const { getByText } = render(<PluginPermissionDialog />);
    expect(getByText('Allow')).toBeTruthy();
    expect(getByText('Deny')).toBeTruthy();
  });
});
