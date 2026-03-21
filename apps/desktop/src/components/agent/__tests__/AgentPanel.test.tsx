import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAgentStore } from '../../../stores/agentStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useChatStore } from '../../../stores/chatStore';

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
  MessageInput: ({ onSend, placeholder, onCancel, disabled }: any) => (
    <div data-testid="message-input">
      <input placeholder={placeholder} disabled={disabled} />
      <button onClick={() => onSend?.('test')} disabled={disabled}>Send</button>
      {onCancel && <button onClick={onCancel}>Cancel</button>}
    </div>
  ),
}));
vi.mock('../../chat/LoadingIndicator', () => ({
  LoadingIndicator: ({ isLoading }: any) =>
    isLoading ? <div data-testid="loading">loading</div> : null,
}));

// Mock API
const mockCreateSession = vi.fn().mockResolvedValue({
  id: 'agent-session-1',
  projectId: 'proj-1',
  type: 'agent',
  name: 'Agent Assistant',
});
const mockGetSessionMessages = vi.fn().mockResolvedValue({ messages: [], pagination: {} });
const mockArchiveSessions = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../services/api', () => ({
  createSession: (...args: any[]) => mockCreateSession(...args),
  getSessionMessages: (...args: any[]) => mockGetSessionMessages(...args),
  archiveSessions: (...args: any[]) => mockArchiveSessions(...args),
}));

// Mock ConnectionContext
const mockSendMessage = vi.fn();
vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    serverUrl: 'http://localhost:3100',
    isConnected: true,
    activeBackend: 'local',
    setActiveBackend: vi.fn(),
    sendMessage: mockSendMessage,
  }),
}));

import { AgentPanel } from '../AgentPanel';

const setExpandedMock = vi.fn();

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

async function renderAgentPanel(props?: ComponentProps<typeof AgentPanel>) {
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(<AgentPanel {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return view!;
}

describe('AgentPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    useAgentStore.setState({
      setExpanded: setExpandedMock,
      isLoading: false,
      clearRequestId: 0,
      agentSessionId: null,
    } as any);
    useProjectStore.setState({
      selectedSessionId: 'sess-1',
      sessions: [{ id: 'sess-1', projectId: 'proj-1', name: 'Test Session' }],
      projects: [{ id: 'proj-1', name: 'Test Project' }],
    } as any);
    useChatStore.setState({
      messages: {},
      activeRuns: {},
    } as any);
  });

  it('renders without crashing', async () => {
    const { container } = await renderAgentPanel();
    expect(container).toBeTruthy();
  });

  it('renders message input', async () => {
    const { container } = await renderAgentPanel();
    expect(container.querySelector('[data-testid="message-input"]')).toBeTruthy();
  });

  it('renders message list', async () => {
    const { container } = await renderAgentPanel();
    expect(container.querySelector('[data-testid="message-list"]')).toBeTruthy();
  });

  it('renders Agent header with label', async () => {
    await renderAgentPanel();
    expect(screen.getByText('Agent')).toBeTruthy();
  });

  it('renders "Server-side" label in header', async () => {
    await renderAgentPanel();
    expect(screen.getByText('Server-side')).toBeTruthy();
  });

  it('calls setExpanded(false) when close button is clicked', async () => {
    await renderAgentPanel();
    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);
    expect(setExpandedMock).toHaveBeenCalledWith(false);
  });

  it('does not render header when showHeader=false', async () => {
    await renderAgentPanel({ showHeader: false });
    expect(screen.queryByText('Agent')).toBeNull();
  });

  it('shows Agent Assistant greeting when no messages', async () => {
    await renderAgentPanel();
    await waitFor(() => {
      expect(screen.queryByText(/Agent Assistant/)).toBeTruthy();
    });
  });

  it('renders quick action buttons', async () => {
    await renderAgentPanel();
    await waitFor(() => {
      expect(screen.queryByText('Search messages')).toBeTruthy();
      expect(screen.queryByText('List sessions')).toBeTruthy();
    });
  });

  it('shows context line when project and session are selected', async () => {
    await renderAgentPanel();
    await waitFor(() => {
      expect(screen.queryByText(/Context:/)).toBeTruthy();
    });
  });

  it('does not show context line when no session selected', async () => {
    useProjectStore.setState({
      selectedSessionId: null,
      sessions: [],
      projects: [],
    } as any);

    await renderAgentPanel();
    await waitFor(() => {
      expect(screen.queryByText(/Context:/)).toBeNull();
    });
  });

  it('shows "Ask me anything..." placeholder after session is created', async () => {
    await renderAgentPanel();
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask me anything...')).toBeTruthy();
    });
  });

  it('creates agent session on mount when none exists', async () => {
    await renderAgentPanel();
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          type: 'agent',
          name: 'Agent Assistant',
        })
      );
    });
  });

  it('renders with isMobile=true', async () => {
    const { container } = await renderAgentPanel({ isMobile: true });
    expect(container).toBeTruthy();
  });

  it('archives the old agent session and creates a fresh one on clear request', async () => {
    useProjectStore.setState({
      selectedSessionId: 'sess-1',
      sessions: [
        { id: 'sess-1', projectId: 'proj-1', name: 'Test Session', type: 'regular' },
        { id: 'agent-old', projectId: 'proj-1', name: 'Agent Assistant', type: 'agent' },
      ],
      projects: [{ id: 'proj-1', name: 'Test Project' }],
    } as any);
    useChatStore.setState({
      messages: {
        'agent-old': [{
          id: 'msg-1',
          sessionId: 'agent-old',
          role: 'assistant',
          content: 'existing',
          createdAt: Date.now(),
        }],
      },
      activeRuns: {},
    } as any);
    mockCreateSession.mockResolvedValueOnce({
      id: 'agent-new',
      projectId: 'proj-1',
      type: 'agent',
      name: 'Agent Assistant',
    });

    await renderAgentPanel();

    await waitFor(() => {
      expect(mockGetSessionMessages).toHaveBeenCalledWith('agent-old');
    });

    act(() => {
      useAgentStore.setState({ clearRequestId: 1 } as any);
    });

    await waitFor(() => {
      expect(mockArchiveSessions).toHaveBeenCalledWith(['agent-old']);
      expect(mockCreateSession).toHaveBeenCalledWith({
        projectId: 'proj-1',
        name: 'Agent Assistant',
        type: 'agent',
      });
    });

    const sessions = useProjectStore.getState().sessions;
    expect(sessions.find((session) => session.id === 'agent-old')?.archivedAt).toEqual(expect.any(Number));
    expect(sessions.some((session) => session.id === 'agent-new')).toBe(true);
    expect(useChatStore.getState().messages['agent-old']).toEqual([]);
  });
});
