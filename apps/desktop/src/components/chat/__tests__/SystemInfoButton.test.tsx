import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SystemInfoButton } from '../SystemInfoButton';

describe('SystemInfoButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when no info available', () => {
    const { container } = render(<SystemInfoButton systemInfo={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders button when system info has model', () => {
    const { getByTitle } = render(
      <SystemInfoButton systemInfo={{ model: 'claude-3' }} />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('renders button when session info provided', () => {
    const { getByTitle } = render(
      <SystemInfoButton
        systemInfo={null}
        sessionInfo={{ id: 's1', name: 'Test Session' }}
      />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('renders button when system info has claudeCodeVersion', () => {
    const { getByTitle } = render(
      <SystemInfoButton systemInfo={{ claudeCodeVersion: '1.0.0' }} />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('renders button when system info has cwd', () => {
    const { getByTitle } = render(
      <SystemInfoButton systemInfo={{ cwd: '/home/user/project' }} />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('renders button when system info has permissionMode', () => {
    const { getByTitle } = render(
      <SystemInfoButton systemInfo={{ permissionMode: 'auto' }} />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('renders button when system info has apiKeySource', () => {
    const { getByTitle } = render(
      <SystemInfoButton systemInfo={{ apiKeySource: 'anthropic' }} />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('renders button when system info has tools', () => {
    const { getByTitle } = render(
      <SystemInfoButton systemInfo={{ tools: ['tool1', 'tool2'] }} />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('renders button when system info has mcpServers', () => {
    const { getByTitle } = render(
      <SystemInfoButton systemInfo={{ mcpServers: ['server1'] }} />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('renders button when system info has agents', () => {
    const { getByTitle } = render(
      <SystemInfoButton systemInfo={{ agents: ['agent1'] }} />
    );
    expect(getByTitle('View system info')).toBeTruthy();
  });

  it('returns null when system info has empty tools array', () => {
    const { container } = render(
      <SystemInfoButton systemInfo={{ tools: [] }} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when system info has empty mcpServers array', () => {
    const { container } = render(
      <SystemInfoButton systemInfo={{ mcpServers: [] }} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('returns null when system info has empty agents array', () => {
    const { container } = render(
      <SystemInfoButton systemInfo={{ agents: [] }} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('expands panel when button is clicked', () => {
    render(<SystemInfoButton systemInfo={{ model: 'claude-3' }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('System Info')).toBeTruthy();
  });

  it('collapses panel when button is clicked again', () => {
    render(<SystemInfoButton systemInfo={{ model: 'claude-3' }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);
    expect(screen.getByText('System Info')).toBeTruthy();

    fireEvent.click(button);
    expect(screen.queryByText('System Info')).toBeNull();
  });

  it('closes panel when close button is clicked', () => {
    render(<SystemInfoButton systemInfo={{ model: 'claude-3' }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);
    expect(screen.getByText('System Info')).toBeTruthy();

    const closeButton = screen.getByText('\u00d7'); // Multiplication sign ×
    fireEvent.click(closeButton);
    expect(screen.queryByText('System Info')).toBeNull();
  });

  it('closes panel when clicking outside', async () => {
    render(
      <div>
        <SystemInfoButton systemInfo={{ model: 'claude-3' }} />
        <div data-testid="outside">Outside element</div>
      </div>
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);
    expect(screen.getByText('System Info')).toBeTruthy();

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside'));

    await waitFor(() => {
      expect(screen.queryByText('System Info')).toBeNull();
    });
  });

  it('displays model info badge', () => {
    render(<SystemInfoButton systemInfo={{ model: 'claude-3-opus' }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('Model:')).toBeTruthy();
    expect(screen.getByText('claude-3-opus')).toBeTruthy();
  });

  it('displays version info badge', () => {
    render(<SystemInfoButton systemInfo={{ claudeCodeVersion: '1.2.3' }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('Version:')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
  });

  it('displays permission mode badge', () => {
    render(<SystemInfoButton systemInfo={{ permissionMode: 'auto' }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('Permission:')).toBeTruthy();
    expect(screen.getByText('auto')).toBeTruthy();
  });

  it('displays API key source badge', () => {
    render(<SystemInfoButton systemInfo={{ apiKeySource: 'anthropic' }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('API Key:')).toBeTruthy();
    expect(screen.getByText('anthropic')).toBeTruthy();
  });

  it('displays working directory', () => {
    render(<SystemInfoButton systemInfo={{ cwd: '/home/user/project' }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('/home/user/project')).toBeTruthy();
  });

  it('displays tools list', () => {
    render(<SystemInfoButton systemInfo={{ tools: ['tool1', 'tool2', 'tool3'] }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('(3)')).toBeTruthy();
    expect(screen.getByText('tool1')).toBeTruthy();
    expect(screen.getByText('tool2')).toBeTruthy();
    expect(screen.getByText('tool3')).toBeTruthy();
  });

  it('displays MCP servers list', () => {
    render(<SystemInfoButton systemInfo={{ mcpServers: ['server1', 'server2'] }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('MCP Servers')).toBeTruthy();
    expect(screen.getByText('(2)')).toBeTruthy();
    expect(screen.getByText('server1')).toBeTruthy();
    expect(screen.getByText('server2')).toBeTruthy();
  });

  it('displays agents list', () => {
    render(<SystemInfoButton systemInfo={{ agents: ['agent1'] }} />);

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('(1)')).toBeTruthy();
    expect(screen.getByText('agent1')).toBeTruthy();
  });

  it('displays session info when provided', () => {
    render(
      <SystemInfoButton
        systemInfo={{ model: 'claude-3' }}
        sessionInfo={{ id: 's1', name: 'My Session', projectName: 'My Project' }}
      />
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('Project:')).toBeTruthy();
    expect(screen.getByText('My Project')).toBeTruthy();
    expect(screen.getByText('Session:')).toBeTruthy();
    expect(screen.getByText('My Session')).toBeTruthy();
    expect(screen.getByText('s1')).toBeTruthy();
  });

  it('displays session id when name is not provided', () => {
    render(
      <SystemInfoButton
        systemInfo={{ model: 'claude-3' }}
        sessionInfo={{ id: 'session-123' }}
      />
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('Session:')).toBeTruthy();
    // Use getAllByText since session id may appear in multiple places (span and title)
    expect(screen.getAllByText('session-123').length).toBeGreaterThanOrEqual(1);
  });

  it('does not display project name when not provided', () => {
    render(
      <SystemInfoButton
        systemInfo={{ model: 'claude-3' }}
        sessionInfo={{ id: 's1' }}
      />
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.queryByText('Project:')).toBeNull();
  });

  it('shows "show more" button when tools exceed 5', () => {
    render(
      <SystemInfoButton
        systemInfo={{ tools: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'] }}
      />
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('expands tools list when "show more" is clicked', () => {
    render(
      <SystemInfoButton
        systemInfo={{ tools: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'] }}
      />
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    // Initially shows 5 items
    expect(screen.getByText('t1')).toBeTruthy();
    expect(screen.queryByText('t6')).toBeNull();

    // Click show more
    fireEvent.click(screen.getByText('+2 more'));

    // Now shows all items
    expect(screen.getByText('t6')).toBeTruthy();
    expect(screen.getByText('t7')).toBeTruthy();
    expect(screen.getByText('show less')).toBeTruthy();
  });

  it('collapses tools list when "show less" is clicked', () => {
    render(
      <SystemInfoButton
        systemInfo={{ tools: ['t1', 't2', 't3', 't4', 't5', 't6'] }}
      />
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    // Expand
    fireEvent.click(screen.getByText('+1 more'));
    expect(screen.getByText('t6')).toBeTruthy();

    // Collapse
    fireEvent.click(screen.getByText('show less'));
    expect(screen.queryByText('t6')).toBeNull();
  });

  it('handles object items in tools list', () => {
    render(
      <SystemInfoButton
        systemInfo={{
          mcpServers: [
            { name: 'Server A', status: 'connected' },
            { name: 'Server B', status: 'disconnected' },
          ],
        }}
      />
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    expect(screen.getByText('Server A')).toBeTruthy();
    expect(screen.getByText('Server B')).toBeTruthy();
  });

  it('applies expanded button styles', () => {
    render(<SystemInfoButton systemInfo={{ model: 'claude-3' }} />);

    const button = screen.getByTitle('View system info');
    expect(button.className).toContain('bg-secondary/50');

    fireEvent.click(button);
    expect(button.className).toContain('bg-card');
  });

  it('renders all info types together', () => {
    render(
      <SystemInfoButton
        systemInfo={{
          model: 'claude-3-opus',
          claudeCodeVersion: '1.0.0',
          cwd: '/home/user/project',
          permissionMode: 'auto',
          apiKeySource: 'anthropic',
          tools: ['tool1'],
          mcpServers: ['server1'],
          agents: ['agent1'],
        }}
        sessionInfo={{
          id: 'session-123',
          name: 'Test Session',
          projectName: 'Test Project',
        }}
      />
    );

    const button = screen.getByTitle('View system info');
    fireEvent.click(button);

    // Verify all sections are present
    expect(screen.getByText('System Info')).toBeTruthy();
    expect(screen.getByText('Test Project')).toBeTruthy();
    expect(screen.getByText('Test Session')).toBeTruthy();
    expect(screen.getByText('claude-3-opus')).toBeTruthy();
    expect(screen.getByText('1.0.0')).toBeTruthy();
    expect(screen.getByText('/home/user/project')).toBeTruthy();
    expect(screen.getByText('auto')).toBeTruthy();
    expect(screen.getByText('anthropic')).toBeTruthy();
    expect(screen.getByText('tool1')).toBeTruthy();
    expect(screen.getByText('server1')).toBeTruthy();
    expect(screen.getByText('agent1')).toBeTruthy();
  });
});
