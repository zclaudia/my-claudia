import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { PluginSettings } from '../PluginSettings';
import { usePluginStore } from '../../stores/pluginStore';

// Mock api
vi.mock('../../services/api', () => ({
  getBaseUrl: () => 'http://localhost:3100',
}));

describe('PluginSettings', () => {
  it('shows loading state', () => {
    usePluginStore.setState({
      plugins: [],
      isLoading: true,
      error: null,
      removePlugin: vi.fn(),
      setError: vi.fn(),
    } as any);
    const { getByText } = render(<PluginSettings />);
    expect(getByText('Loading plugins...')).toBeTruthy();
  });

  it('shows error state', () => {
    usePluginStore.setState({
      plugins: [],
      isLoading: false,
      error: 'Failed to load',
      removePlugin: vi.fn(),
      setError: vi.fn(),
    } as any);
    const { getByText } = render(<PluginSettings />);
    expect(getByText('Failed to load')).toBeTruthy();
  });

  it('shows empty state when no plugins', () => {
    usePluginStore.setState({
      plugins: [],
      isLoading: false,
      error: null,
      removePlugin: vi.fn(),
      setError: vi.fn(),
    } as any);
    const { getByText } = render(<PluginSettings />);
    expect(getByText('No plugins installed')).toBeTruthy();
  });

  it('renders plugin cards', () => {
    usePluginStore.setState({
      plugins: [{
        manifest: {
          id: 'com.test.plugin',
          name: 'Test Plugin',
          version: '1.0.0',
          description: 'A test plugin',
        },
        status: 'active',
        enabled: true,
      }],
      isLoading: false,
      error: null,
      removePlugin: vi.fn(),
      setError: vi.fn(),
    } as any);
    const { getByText, container } = render(<PluginSettings />);
    expect(getByText('Test Plugin')).toBeTruthy();
    expect(container.textContent).toContain('Active');
  });
});
