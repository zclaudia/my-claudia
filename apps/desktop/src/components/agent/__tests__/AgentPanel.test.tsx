import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAgentStore } from '../../../stores/agentStore';
import { useProjectStore } from '../../../stores/projectStore';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));

// Mock heavy sub-components
vi.mock('../../chat/MessageList', () => ({
  MessageList: ({ messages }: any) => (
    <div data-testid="message-list">{messages?.length ?? 0} messages</div>
  ),
}));
vi.mock('../../chat/MessageInput', () => ({
  MessageInput: ({ onSend, placeholder, onCancel }: any) => (
    <div data-testid="message-input">
      <input placeholder={placeholder} />
      <button onClick={() => onSend?.('test')}>Send</button>
      {onCancel && <button onClick={onCancel}>Cancel</button>}
    </div>
  ),
}));
vi.mock('../../chat/LoadingIndicator', () => ({
  LoadingIndicator: ({ isLoading }: any) =>
    isLoading ? <div data-testid="loading">loading</div> : null,
}));

// Mock services
vi.mock('../../../services/clientAI', () => ({
  getClientAIConfig: () => ({ model: 'test-model' }),
}));

vi.mock('../../../services/agentLoop', () => ({
  initAgentLoop: vi.fn(() => Promise.resolve([])),
  sendMessage: vi.fn(() => Promise.resolve()),
  clearConversation: vi.fn(),
  cancelAgentLoop: vi.fn(),
}));

// Mock ConnectionContext
vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    serverUrl: 'http://localhost:3100',
    isConnected: true,
    activeBackend: 'local',
    setActiveBackend: vi.fn(),
    sendMessage: vi.fn(),
  }),
}));

import { AgentPanel } from '../AgentPanel';

const setExpandedMock = vi.fn();

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

describe('AgentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useAgentStore.setState({
      setExpanded: setExpandedMock,
      isLoading: false,
      clearRequestId: 0,
    } as any);
    useProjectStore.setState({
      selectedSessionId: 'sess-1',
      sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Test Session' }],
      projects: [{ id: 'proj-1', name: 'Test Project' }],
    } as any);
  });

  it('renders without crashing', () => {
    const { container } = render(<AgentPanel />);
    expect(container).toBeTruthy();
  });

  it('renders message input', () => {
    const { container } = render(<AgentPanel />);
    expect(container.querySelector('[data-testid="message-input"]')).toBeTruthy();
  });

  it('renders message list', () => {
    const { container } = render(<AgentPanel />);
    expect(container.querySelector('[data-testid="message-list"]')).toBeTruthy();
  });

  it('renders Agent header with label', () => {
    render(<AgentPanel />);
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('renders model name in header', () => {
    render(<AgentPanel />);
    expect(screen.getByText('test-model')).toBeTruthy();
  });

  it('calls setExpanded(false) when close button is clicked', () => {
    render(<AgentPanel />);
    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);
    expect(setExpandedMock).toHaveBeenCalledWith(false);
  });

  it('does not render header when showHeader=false', () => {
    render(<AgentPanel showHeader={false} />);
    expect(screen.queryByText('Agent')).toBeNull();
  });

  it('renders quick action buttons when messages are empty', async () => {
    render(<AgentPanel />);
    await waitFor(() => {
      expect(screen.queryByText('Search messages')).toBeTruthy();
    });
  });

  it('shows context line when project and session are selected', async () => {
    render(<AgentPanel />);
    await waitFor(() => {
      expect(screen.queryByText(/Context:/)).toBeTruthy();
    });
  });

  it('renders with isMobile=true', () => {
    const { container } = render(<AgentPanel isMobile={true} />);
    expect(container).toBeTruthy();
  });

  it('shows Meta-Agent greeting when no messages', async () => {
    render(<AgentPanel />);
    await waitFor(() => {
      expect(screen.queryByText(/Hi! I'm your Meta-Agent/)).toBeTruthy();
    });
  });

  it('shows loading indicator when isLoading is true', () => {
    useAgentStore.setState({
      setExpanded: setExpandedMock,
      isLoading: true,
      clearRequestId: 0,
    } as any);
    const { container } = render(<AgentPanel />);
    expect(container.querySelector('[data-testid="loading"]')).toBeTruthy();
  });

  it('calls clearConversation when clearRequestId is nonzero', async () => {
    const agentLoop = await import('../../../services/agentLoop');
    useAgentStore.setState({
      setExpanded: setExpandedMock,
      isLoading: false,
      clearRequestId: 1,
    } as any);

    render(<AgentPanel />);
    await waitFor(() => {
      expect(agentLoop.clearConversation).toHaveBeenCalled();
    });
  });

  it('does not show context line when no session selected', async () => {
    useProjectStore.setState({
      selectedSessionId: null,
      sessions: [],
      projects: [],
    } as any);

    render(<AgentPanel />);
    await waitFor(() => {
      expect(screen.queryByText(/Context:/)).toBeNull();
    });
  });

  it('sends message when quick action is clicked', async () => {
    const agentLoop = await import('../../../services/agentLoop');
    render(<AgentPanel />);
    // Wait for quick actions to appear
    await waitFor(() => {
      expect(screen.queryByText('List sessions')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('List sessions'));
    expect(agentLoop.sendMessage).toHaveBeenCalled();
  });

  it('shows "Working..." placeholder when loading', () => {
    useAgentStore.setState({
      setExpanded: setExpandedMock,
      isLoading: true,
      clearRequestId: 0,
    } as any);

    render(<AgentPanel />);
    expect(screen.getByPlaceholderText('Working...')).toBeTruthy();
  });

  it('shows "Ask me anything..." placeholder when not loading', async () => {
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText('Ask me anything...')).toBeTruthy();
  });

  it('renders all quick action labels', async () => {
    render(<AgentPanel />);
    await waitFor(() => {
      expect(screen.getByText('Search messages')).toBeInTheDocument();
      expect(screen.getByText('List sessions')).toBeInTheDocument();
      expect(screen.getByText('Summarize session')).toBeInTheDocument();
      expect(screen.getByText('Browse files')).toBeInTheDocument();
    });
  });

  it('renders message list component', async () => {
    const { container } = render(<AgentPanel />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="message-list"]')).toBeInTheDocument();
    });
  });

  it('handles empty sessions gracefully', async () => {
    useProjectStore.setState({
      selectedSessionId: 'sess-1',
      sessions: [{ id: 'sess-1', projectId: 'proj-1', name: '' }],
      projects: [{ id: 'proj-1', name: 'Test Project' }],
    } as any);
    render(<AgentPanel />);
    await waitFor(() => {
      expect(screen.queryByText(/Context:/)).toBeTruthy();
    });
  });
});
