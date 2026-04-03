import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ProviderManager } from '../ProviderManager';
import * as api from '../../services/api';

const ASYNC_TIMEOUT = 200;
const waitForFast = (assertion: Parameters<typeof waitFor>[0]) =>
  waitFor(assertion, { timeout: ASYNC_TIMEOUT });

async function renderProviderManager(props: Partial<Parameters<typeof ProviderManager>[0]> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<ProviderManager isOpen={true} onClose={vi.fn()} {...props} />);
    await Promise.resolve();
  });
  return view;
}

async function clickAsync(target: Element) {
  await act(async () => {
    fireEvent.click(target);
    await Promise.resolve();
  });
}

const mockServerState = {
  activeServerId: 'local',
  connections: {
    local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
  },
};

const mockRecoveryState = {
  backends: {
    local: { status: 'ready' },
  },
};

const { mockProviderMetaState, useProviderMetaStoreMock } = vi.hoisted(() => {
  const state = {
    getProviders: vi.fn(() => []),
  };

  const store = Object.assign(
    vi.fn((selector?: (currentState: typeof state) => unknown) => (
      typeof selector === 'function' ? selector(state) : state
    )),
    {
      getState: () => state,
    }
  );

  return {
    mockProviderMetaState: state,
    useProviderMetaStoreMock: store,
  };
});

// Mock the serverStore with selector support
vi.mock('../../stores/serverStore', () => ({
  useServerStore: vi.fn((selector?: (state: typeof mockServerState) => unknown) => (
    typeof selector === 'function' ? selector(mockServerState) : mockServerState
  )),
}));

vi.mock('../../stores/recoveryStore', () => ({
  useRecoveryStore: vi.fn((selector?: (state: typeof mockRecoveryState) => unknown) => (
    typeof selector === 'function' ? selector(mockRecoveryState) : mockRecoveryState
  )),
}));

vi.mock('../../stores/providerMetaStore', () => ({
  useProviderMetaStore: useProviderMetaStoreMock,
}));

const mockSetProviders = vi.fn();
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      setProviders: mockSetProviders,
    }),
  },
}));

vi.mock('../../hooks/useAndroidBack', () => ({
  useAndroidBack: vi.fn(),
}));

// Mock the api module
vi.mock('../../services/api', () => ({
  getProviders: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  setDefaultProvider: vi.fn(),
}));

import { useServerStore } from '../../stores/serverStore';

describe('ProviderManager', () => {
  const mockOnClose = vi.fn();

  const mockProviders = [
    {
      id: 'p1',
      name: 'Claude Default',
      type: 'claude' as const,
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'p2',
      name: 'Work Claude',
      type: 'claude' as const,
      cliPath: '/usr/local/bin/claude',
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getProviders).mockResolvedValue(mockProviders);
    vi.mocked(api.createProvider).mockResolvedValue(mockProviders[0]);
    vi.mocked(api.updateProvider).mockResolvedValue(undefined);
    vi.mocked(api.deleteProvider).mockResolvedValue(undefined);
    vi.mocked(api.setDefaultProvider).mockResolvedValue(undefined);
    mockProviderMetaState.getProviders.mockReturnValue([]);
    mockServerState.activeServerId = 'local';
    mockServerState.connections.local.status = 'connected';
    mockRecoveryState.backends.local.status = 'ready';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when not open', () => {
    const { container } = render(
      <ProviderManager isOpen={false} onClose={mockOnClose} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when open', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    expect(screen.getByText('Provider Management')).toBeInTheDocument();
  });

  it('shows "Connect to a server first" when disconnected', async () => {
    mockRecoveryState.backends.local.status = 'offline';

    await renderProviderManager({ onClose: mockOnClose });

    expect(screen.getByText('Connect to a server first')).toBeInTheDocument();
  });

  it('loads and displays providers on open', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(api.getProviders).toHaveBeenCalled();
    });

    expect(screen.getByText('Claude Default')).toBeInTheDocument();
    expect(screen.getByText('Work Claude')).toBeInTheDocument();
  });

  it('shows Default badge for default provider', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Claude Default')).toBeInTheDocument();
    });

    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('shows provider type badge', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Claude Default')).toBeInTheDocument();
    });

    const claudeBadges = screen.getAllByText('claude');
    expect(claudeBadges.length).toBeGreaterThan(0);
  });

  it('shows cliPath for provider that has one', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('/usr/local/bin/claude')).toBeInTheDocument();
    });
  });

  it('shows empty state when no providers', async () => {
    vi.mocked(api.getProviders).mockResolvedValue([]);

    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText(/No providers configured/)).toBeInTheDocument();
    });
  });

  it('closes modal when backdrop is clicked', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    // The backdrop is the first div with bg-black/50
    const backdrop = document.querySelector('.bg-black\\/50');
    expect(backdrop).toBeInTheDocument();
    await clickAsync(backdrop!);

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('closes modal when close button is clicked', async () => {
    await renderProviderManager({ onClose: mockOnClose });

    await waitForFast(() => {
      expect(screen.getByText('Provider Management')).toBeInTheDocument();
    });

    // Find close button by finding the header and its button
    const header = screen.getByText('Provider Management').closest('div')?.parentElement;
    const closeBtn = header?.querySelector('button');
    expect(closeBtn).toBeTruthy();
    if (closeBtn) {
      await clickAsync(closeBtn);
      expect(mockOnClose).toHaveBeenCalled();
    }
  });

  describe('Add Provider Form', () => {
    it('shows add form when Add Provider button is clicked', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      // Check for form elements by their text content since labels don't have htmlFor
      expect(screen.getByText(/Name \*/)).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Personal Claude/)).toBeInTheDocument();
    });

    it('creates provider on form submit', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const nameInput = screen.getByPlaceholderText(/Personal Claude/);
      fireEvent.change(nameInput, { target: { value: 'New Provider' } });

      await clickAsync(screen.getByText('Create'));

      await waitForFast(() => {
        expect(api.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'New Provider',
            type: 'claude',
          })
        );
      });
    });

    it('does not submit when name is empty', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      // Create button should be disabled when name is empty
      const createButton = screen.getByText('Create');
      expect(createButton).toBeDisabled();
    });

    it('goes back to list when Cancel is clicked', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitForFast(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      expect(screen.getByText('Create')).toBeInTheDocument();

      await clickAsync(screen.getByText('Cancel'));

      expect(screen.queryByText('Create')).not.toBeInTheDocument();
      expect(screen.getByText('Add Provider')).toBeInTheDocument();
    });
  });

  describe('Edit Provider', () => {
    it('populates form when Edit is clicked', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Work Claude')).toBeInTheDocument();
      });

      // Click the edit button for Work Claude
      const editButtons = screen.getAllByTitle('Edit');
      await clickAsync(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByDisplayValue('Claude Default')).toBeInTheDocument();
      });
    });

    it('calls updateProvider on edit submit', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle('Edit');
      await clickAsync(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Update')).toBeInTheDocument();
      });

      const nameInput = screen.getByDisplayValue('Claude Default');
      fireEvent.change(nameInput, { target: { value: 'Updated Name' } });

      await clickAsync(screen.getByText('Update'));

      await waitFor(() => {
        expect(api.updateProvider).toHaveBeenCalledWith(
          'p1',
          expect.objectContaining({
            name: 'Updated Name',
          })
        );
      });
    });
  });

  describe('Delete Provider', () => {
    it('calls deleteProvider when delete is confirmed', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete');
      await clickAsync(deleteButtons[0]);

      expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to delete this provider?');
      expect(api.deleteProvider).toHaveBeenCalledWith('p1');

      confirmSpy.mockRestore();
    });

    it('does not delete when confirm is cancelled', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      const deleteButtons = screen.getAllByTitle('Delete');
      await clickAsync(deleteButtons[0]);

      expect(confirmSpy).toHaveBeenCalled();
      expect(api.deleteProvider).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });
  });

  describe('Set Default Provider', () => {
    it('calls setDefaultProvider when set default is clicked', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Work Claude')).toBeInTheDocument();
      });

      // Set default button only appears for non-default providers
      const setDefaultButtons = screen.getAllByTitle('Set as default');
      await clickAsync(setDefaultButtons[0]);

      expect(api.setDefaultProvider).toHaveBeenCalledWith('p2');
    });

    it('does not show set default button for already default provider', async () => {
      vi.mocked(api.getProviders).mockResolvedValue([
        {
          id: 'p1',
          name: 'Only Provider',
          type: 'claude',
          isDefault: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Only Provider')).toBeInTheDocument();
      });

      expect(screen.queryByTitle('Set as default')).not.toBeInTheDocument();
    });
  });

  describe('Form validation', () => {
    it('shows alert for invalid JSON in env field', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const nameInput = screen.getByPlaceholderText(/Personal Claude/);
      fireEvent.change(nameInput, { target: { value: 'New Provider' } });

      const envTextarea = screen.getByPlaceholderText(/ANTHROPIC_API_KEY/);
      fireEvent.change(envTextarea, { target: { value: 'invalid json' } });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith('Invalid JSON in environment variables');
      });

      expect(api.createProvider).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });

    it('accepts valid JSON in env field', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      const nameInput = screen.getByPlaceholderText(/Personal Claude/);
      fireEvent.change(nameInput, { target: { value: 'New Provider' } });

      const envTextarea = screen.getByPlaceholderText(/ANTHROPIC_API_KEY/);
      fireEvent.change(envTextarea, { target: { value: '{"API_KEY": "test"}' } });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(api.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({
            env: { API_KEY: 'test' },
          })
        );
      });
    });
  });

  describe('Error handling', () => {
    it('shows alert when createProvider fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      vi.mocked(api.createProvider).mockRejectedValueOnce(new Error('Network error'));

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      fireEvent.change(screen.getByPlaceholderText(/Personal Claude/), { target: { value: 'New' } });
      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to create provider'));
      });
      alertSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('shows alert when deleteProvider fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.mocked(api.deleteProvider).mockRejectedValueOnce(new Error('Delete error'));

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Delete')[0]);

      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to delete provider'));
      });
      alertSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('logs error when setDefaultProvider fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.setDefaultProvider).mockRejectedValueOnce(new Error('Set default error'));

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Work Claude')).toBeInTheDocument();
      });

      await clickAsync(screen.getAllByTitle('Set as default')[0]);

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to set default provider:', expect.any(Error));
      });
      consoleSpy.mockRestore();
    });

    it('logs error when getProviders fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.getProviders).mockRejectedValueOnce(new Error('Load error'));

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to load providers:', expect.any(Error));
      });
      consoleSpy.mockRestore();
    });
  });

  describe('Inline mode', () => {
    it('renders content without modal wrapper in inline mode', async () => {
      await renderProviderManager({ onClose: mockOnClose, inline: true });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      // Should NOT have modal wrapper
      expect(screen.queryByText('Provider Management')).not.toBeInTheDocument();
      expect(document.querySelector('.bg-black\\/50')).not.toBeInTheDocument();
    });
  });

  describe('TypeSelector dropdown', () => {
    it('opens and selects a type', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));

      // Click the Type selector button
      await clickAsync(screen.getByText('Claude'));

      // Dropdown should show all options
      expect(screen.getByText('OpenCode')).toBeInTheDocument();
      expect(screen.getByText('Codex')).toBeInTheDocument();
      expect(screen.getByText('Cursor Agent')).toBeInTheDocument();
      expect(screen.getByText('Kimi Code')).toBeInTheDocument();

      // Select OpenCode
      await clickAsync(screen.getByText('OpenCode'));

      // CLI path placeholder should change to opencode-specific
      expect(screen.getByPlaceholderText('/path/to/opencode')).toBeInTheDocument();
    });
  });

  describe('Edit form with env', () => {
    it('populates env field when editing provider with env', async () => {
      vi.mocked(api.getProviders).mockResolvedValue([
        {
          id: 'p1',
          name: 'Provider With Env',
          type: 'claude' as const,
          isDefault: false,
          env: { API_KEY: 'secret' },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);

      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Provider With Env')).toBeInTheDocument();
      });

      await clickAsync(screen.getByTitle('Edit'));

      await waitFor(() => {
        expect(screen.getByText('Update')).toBeInTheDocument();
      });

      // Env textarea should have JSON content
      const envTextarea = screen.getByPlaceholderText(/ANTHROPIC_API_KEY/);
      expect(envTextarea).toHaveValue(JSON.stringify({ API_KEY: 'secret' }, null, 2));
    });
  });

  describe('isDefault checkbox', () => {
    it('submits isDefault flag', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      fireEvent.change(screen.getByPlaceholderText(/Personal Claude/), { target: { value: 'New' } });

      const checkbox = screen.getByLabelText('Set as default provider');
      await clickAsync(checkbox);

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(api.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ isDefault: true })
        );
      });
    });
  });

  describe('CLI path in form', () => {
    it('submits cliPath when provided', async () => {
      await renderProviderManager({ onClose: mockOnClose });

      await waitFor(() => {
        expect(screen.getByText('Claude Default')).toBeInTheDocument();
      });

      await clickAsync(screen.getByText('Add Provider'));
      fireEvent.change(screen.getByPlaceholderText(/Personal Claude/), { target: { value: 'Custom' } });
      fireEvent.change(screen.getByPlaceholderText(/\/path\/to\/claude/), { target: { value: '/usr/bin/claude' } });

      await clickAsync(screen.getByText('Create'));

      await waitFor(() => {
        expect(api.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ cliPath: '/usr/bin/claude' })
        );
      });
    });
  });
});
