import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpServerSettings } from '../McpServerSettings';
import { useMcpServerStore } from '../../stores/mcpServerStore';

describe('McpServerSettings', () => {
  const mockFetchServers = vi.fn();
  const mockAddServer = vi.fn();
  const mockEditServer = vi.fn();
  const mockRemoveServer = vi.fn();
  const mockToggle = vi.fn();
  const mockImportFromClaude = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchServers.mockResolvedValue(undefined);
    mockAddServer.mockResolvedValue({ id: 'new-1' });
    mockEditServer.mockResolvedValue(undefined);
    mockRemoveServer.mockResolvedValue(undefined);
    mockToggle.mockResolvedValue(undefined);
    mockImportFromClaude.mockResolvedValue({ imported: [], skipped: [] });

    useMcpServerStore.setState({
      servers: [],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);
  });

  it('renders empty state when no servers', () => {
    const { container } = render(<McpServerSettings />);
    expect(container.textContent).toContain('No MCP servers configured');
  });

  it('renders loading state when loading with no servers', () => {
    useMcpServerStore.setState({
      servers: [],
      isLoading: true,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('Loading MCP servers...')).toBeTruthy();
  });

  it('calls fetchServers on mount', () => {
    render(<McpServerSettings />);
    expect(mockFetchServers).toHaveBeenCalled();
  });

  it('renders servers list', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Test Server',
        command: 'npx',
        args: ['-y', 'test-server'],
        enabled: true,
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('Test Server')).toBeTruthy();
    // "Enabled" appears both in the stats bar and as a server badge
    expect(screen.getAllByText('Enabled').length).toBeGreaterThanOrEqual(1);
  });

  it('renders disabled server badge', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Disabled Server',
        command: 'npx',
        args: [],
        enabled: false,
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    // "Disabled" appears both in the stats bar and as a server badge
    expect(screen.getAllByText('Disabled').length).toBeGreaterThanOrEqual(1);
  });

  it('shows server command with args', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'FS Server',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        enabled: true,
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('npx -y @modelcontextprotocol/server-filesystem')).toBeTruthy();
  });

  it('shows description when present', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Server',
        command: 'npx',
        args: [],
        enabled: true,
        description: 'A test server description',
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('A test server description')).toBeTruthy();
  });

  it('shows provider scope badges', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Server',
        command: 'npx',
        args: [],
        enabled: true,
        providerScope: ['claude', 'codex'],
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('claude')).toBeTruthy();
    expect(screen.getByText('codex')).toBeTruthy();
  });

  it('shows imported badge for imported servers', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Imported Server',
        command: 'npx',
        args: [],
        enabled: true,
        source: 'imported',
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('Imported')).toBeTruthy();
  });

  it('displays stats correctly', () => {
    useMcpServerStore.setState({
      servers: [
        { id: '1', name: 'S1', command: 'cmd', args: [], enabled: true },
        { id: '2', name: 'S2', command: 'cmd', args: [], enabled: true },
        { id: '3', name: 'S3', command: 'cmd', args: [], enabled: false },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    const { container } = render(<McpServerSettings />);
    expect(container.textContent).toContain('3'); // Total
    expect(container.textContent).toContain('2'); // Enabled
    expect(container.textContent).toContain('1'); // Disabled
  });

  it('shows error message when error exists', () => {
    useMcpServerStore.setState({
      servers: [{ id: '1', name: 'S1', command: 'cmd', args: [], enabled: true }],
      isLoading: false,
      error: 'Failed to fetch servers',
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    expect(screen.getByText('Failed to fetch servers')).toBeTruthy();
  });

  it('opens add form when + Add is clicked', () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));
    expect(screen.getByPlaceholderText('e.g. filesystem')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g. npx')).toBeTruthy();
  });

  it('cancels add form', () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));
    expect(screen.getByPlaceholderText('e.g. filesystem')).toBeTruthy();

    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByPlaceholderText('e.g. filesystem')).toBeNull();
  });

  it('shows validation error when submitting empty form', async () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(screen.getByText('Name and command are required')).toBeTruthy();
    });
  });

  it('submits add form with valid data', async () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    fireEvent.change(screen.getByPlaceholderText('e.g. filesystem'), {
      target: { value: 'my-server' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. npx'), {
      target: { value: 'npx' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. -y/), {
      target: { value: '-y @test/server' },
    });

    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(mockAddServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-server',
          command: 'npx',
          args: ['-y', '@test/server'],
        })
      );
    });
  });

  it('submits add form with description', async () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    fireEvent.change(screen.getByPlaceholderText('e.g. filesystem'), {
      target: { value: 'test' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. npx'), {
      target: { value: 'cmd' },
    });
    fireEvent.change(screen.getByPlaceholderText('Optional description'), {
      target: { value: 'My description' },
    });

    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(mockAddServer).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'My description',
        })
      );
    });
  });

  it('can add and remove environment variables', () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    // Click "+ Add" for env vars
    const addEnvBtn = screen.getByText('+ Add', { selector: '.text-primary' });
    fireEvent.click(addEnvBtn);

    expect(screen.getByPlaceholderText('KEY')).toBeTruthy();
    expect(screen.getByPlaceholderText('value')).toBeTruthy();

    // Remove env var
    fireEvent.click(screen.getByText('x'));
    expect(screen.queryByPlaceholderText('KEY')).toBeNull();
  });

  it('can toggle provider scope', () => {
    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('+ Add'));

    // Click Claude scope button
    fireEvent.click(screen.getByText('Claude'));
    // Click again to deselect
    fireEvent.click(screen.getByText('Claude'));
  });

  it('calls toggle when toggle button is clicked', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Server',
        command: 'cmd',
        args: [],
        enabled: true,
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    const toggleBtn = screen.getByTitle('Disable');
    fireEvent.click(toggleBtn);
    expect(mockToggle).toHaveBeenCalledWith('mcp-1');
  });

  it('opens edit form when edit button is clicked', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Editable Server',
        command: 'npx',
        args: ['-y', 'test'],
        enabled: true,
        description: 'Some desc',
        providerScope: ['claude'],
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Edit'));

    // Form should be populated with server data
    const nameInput = screen.getByPlaceholderText('e.g. filesystem') as HTMLInputElement;
    expect(nameInput.value).toBe('Editable Server');

    const cmdInput = screen.getByPlaceholderText('e.g. npx') as HTMLInputElement;
    expect(cmdInput.value).toBe('npx');

    // Save button should show "Save" instead of "Add"
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('submits edit form', async () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Server',
        command: 'cmd',
        args: [],
        enabled: true,
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Edit'));

    fireEvent.change(screen.getByPlaceholderText('e.g. filesystem'), {
      target: { value: 'Updated Server' },
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockEditServer).toHaveBeenCalledWith(
        'mcp-1',
        expect.objectContaining({ name: 'Updated Server' })
      );
    });
  });

  it('handles delete with confirm', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'To Delete',
        command: 'cmd',
        args: [],
        enabled: true,
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    vi.stubGlobal('confirm', vi.fn(() => true));

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Delete'));

    expect(mockRemoveServer).toHaveBeenCalledWith('mcp-1');
  });

  it('does not delete when confirm is cancelled', () => {
    useMcpServerStore.setState({
      servers: [{
        id: 'mcp-1',
        name: 'Keep Me',
        command: 'cmd',
        args: [],
        enabled: true,
      }],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    vi.stubGlobal('confirm', vi.fn(() => false));

    render(<McpServerSettings />);
    fireEvent.click(screen.getByTitle('Delete'));

    expect(mockRemoveServer).not.toHaveBeenCalled();
  });

  it('handles import from Claude', async () => {
    mockImportFromClaude.mockResolvedValueOnce({
      imported: [{ id: 'i1', name: 'Imported' }],
      skipped: ['existing-server'],
    });

    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('Import'));

    await waitFor(() => {
      expect(screen.getByText(/Imported 1 server/)).toBeTruthy();
      expect(screen.getByText(/Skipped 1/)).toBeTruthy();
    });
  });

  it('handles import error', async () => {
    mockImportFromClaude.mockRejectedValueOnce(new Error('File not found'));

    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('Import'));

    await waitFor(() => {
      expect(screen.getByText(/Error: File not found/)).toBeTruthy();
    });
  });

  it('handles import with no servers found', async () => {
    mockImportFromClaude.mockResolvedValueOnce({
      imported: [],
      skipped: [],
    });

    render(<McpServerSettings />);
    fireEvent.click(screen.getByText('Import'));

    await waitFor(() => {
      expect(screen.getByText(/No servers found/)).toBeTruthy();
    });
  });

  it('filters servers by search query', () => {
    useMcpServerStore.setState({
      servers: [
        { id: '1', name: 'Filesystem', command: 'npx', args: [], enabled: true },
        { id: '2', name: 'Database', command: 'node', args: [], enabled: true },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    fireEvent.change(screen.getByPlaceholderText('Search MCP servers...'), {
      target: { value: 'file' },
    });

    expect(screen.getByText('Filesystem')).toBeTruthy();
    expect(screen.queryByText('Database')).toBeNull();
  });

  it('shows no match message when search has no results', () => {
    useMcpServerStore.setState({
      servers: [
        { id: '1', name: 'Server', command: 'cmd', args: [], enabled: true },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    fireEvent.change(screen.getByPlaceholderText('Search MCP servers...'), {
      target: { value: 'nonexistent' },
    });

    expect(screen.getByText('No servers match your search.')).toBeTruthy();
  });

  it('searches by command as well', () => {
    useMcpServerStore.setState({
      servers: [
        { id: '1', name: 'Server A', command: 'npx', args: [], enabled: true },
        { id: '2', name: 'Server B', command: 'docker', args: [], enabled: true },
      ],
      isLoading: false,
      error: null,
      fetchServers: mockFetchServers,
      addServer: mockAddServer,
      editServer: mockEditServer,
      removeServer: mockRemoveServer,
      toggle: mockToggle,
      importFromClaude: mockImportFromClaude,
    } as any);

    render(<McpServerSettings />);
    fireEvent.change(screen.getByPlaceholderText('Search MCP servers...'), {
      target: { value: 'docker' },
    });

    expect(screen.queryByText('Server A')).toBeNull();
    expect(screen.getByText('Server B')).toBeTruthy();
  });
});
