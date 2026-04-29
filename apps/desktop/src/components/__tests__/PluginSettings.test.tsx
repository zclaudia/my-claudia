import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PluginSettings } from '../../features/settings/PluginSettings';
import { usePluginStore } from '../../stores/pluginStore';

// Mock api
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal() as object),
  getBaseUrl: () => 'http://localhost:3100',
}));

describe('PluginSettings', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function renderSettings() {
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(<PluginSettings />);
      await Promise.resolve();
    });
    return view;
  }

  it('shows loading state', async () => {
    usePluginStore.setState({
      plugins: [],
      isLoading: true,
      error: null,
      removePlugin: vi.fn(),
      setError: vi.fn(),
    } as any);
    const { getByText } = await renderSettings();
    expect(getByText('Loading plugins...')).toBeTruthy();
  });

  it('shows error state', async () => {
    usePluginStore.setState({
      plugins: [],
      isLoading: false,
      error: 'Failed to load',
      removePlugin: vi.fn(),
      setError: vi.fn(),
    } as any);
    const { getByText } = await renderSettings();
    expect(getByText('Failed to load')).toBeTruthy();
  });

  it('shows empty state when no plugins', async () => {
    usePluginStore.setState({
      plugins: [],
      isLoading: false,
      error: null,
      removePlugin: vi.fn(),
      setError: vi.fn(),
    } as any);
    const { getByText } = await renderSettings();
    expect(getByText('No plugins installed')).toBeTruthy();
  });

  it('renders plugin cards', async () => {
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
    const { getByText, container } = await renderSettings();
    expect(getByText('Test Plugin')).toBeTruthy();
    expect(container.textContent).toContain('Active');
  });
});
