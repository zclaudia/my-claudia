// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMessagePagination } from '../chat/useMessagePagination';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useFilePushStore } from '../../stores/filePushStore';

vi.mock('../../services/api', () => ({
  getSessionMessages: vi.fn(),
}));

import * as api from '../../services/api';

describe('useMessagePagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      messages: {},
      pagination: {},
      activeRuns: {},
      backgroundRunIds: new Set(),
      runHealth: {},
      activeToolCalls: {},
      toolCallsHistory: {},
      runContentBlocks: {},
      systemInfoBySession: {},
      modeOverrides: {},
      runtimeModes: {},
      sessionUsage: {},
      modelOverrides: {},
      permissionOverrides: {},
      worktreeOverrides: {},
      drafts: {},
    });
    useUIStore.setState({
      forceScrollToBottomSessionId: null,
      pendingMessageJump: null,
      poppedOutSessions: new Map(),
    });
    useFilePushStore.setState({ items: [] });
  });

  it('loads initial messages via HTTP even before websocket reports connected', async () => {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'hello',
          createdAt: 1,
        } as any,
      ],
      pagination: {
        total: 1,
        hasMore: false,
        maxOffset: 1,
      },
      activeRun: null,
    });

    const { result } = renderHook(
      ({ isConnected }) => useMessagePagination({
        sessionId: 'session-1',
        isConnected,
        isMobile: false,
      }),
      {
        initialProps: { isConnected: false },
      }
    );

    await waitFor(() => {
      expect(api.getSessionMessages).toHaveBeenCalledWith('session-1', {
        limit: 50,
        signal: expect.any(AbortSignal),
      });
    });

    await waitFor(() => {
      expect(result.current.initialLoadDone).toBe(true);
    });

    expect(useChatStore.getState().messages['session-1']).toHaveLength(1);
  });

  it('sets a friendly offline error when the initial fetch fails with backend offline', async () => {
    vi.mocked(api.getSessionMessages).mockRejectedValue(new Error('BACKEND_OFFLINE'));

    const { result } = renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(result.current.initialLoadDone).toBe(true);
    });

    expect(result.current.loadError).toContain('Backend is offline');
    expect(useChatStore.getState().messages['session-1']).toEqual([]);
  });

  it('preserves cached messages when the initial fetch fails offline', async () => {
    vi.mocked(api.getSessionMessages).mockRejectedValue(new Error('BACKEND_OFFLINE'));
    useChatStore.setState({
      ...useChatStore.getState(),
      messages: {
        'session-1': [
          {
            id: 'cached-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'cached message',
            createdAt: 1,
          } as any,
        ],
      },
      pagination: {
        'session-1': {
          total: 1,
          hasMore: false,
          maxOffset: 1,
        },
      },
    });

    const { result } = renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(result.current.initialLoadDone).toBe(true);
    });

    expect(result.current.loadError).toContain('Backend is offline');
    expect(useChatStore.getState().messages['session-1']).toEqual([
      expect.objectContaining({ id: 'cached-1', content: 'cached message' }),
    ]);
  });

  it('uses aroundMessageId when a pending message jump targets the session', async () => {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [],
      pagination: {
        total: 0,
        hasMore: false,
      },
      activeRun: null,
    });
    useUIStore.setState({
      ...useUIStore.getState(),
      pendingMessageJump: {
        sessionId: 'session-1',
        messageId: 'msg-42',
      },
    });

    renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(api.getSessionMessages).toHaveBeenCalledWith('session-1', {
        limit: 50,
        aroundMessageId: 'msg-42',
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('syncs file push metadata from loaded messages into filePushStore', async () => {
    vi.mocked(api.getSessionMessages).mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'download ready',
          createdAt: 1,
          metadata: {
            filePush: {
              fileId: 'file-1',
              fileName: 'report.txt',
              mimeType: 'text/plain',
              fileSize: 128,
              description: 'Generated report',
            },
          },
        } as any,
      ],
      pagination: {
        total: 1,
        hasMore: false,
        maxOffset: 1,
      },
      activeRun: null,
    });

    renderHook(() =>
      useMessagePagination({
        sessionId: 'session-1',
        isConnected: true,
        isMobile: false,
      })
    );

    await waitFor(() => {
      expect(useFilePushStore.getState().items).toHaveLength(1);
    });

    expect(useFilePushStore.getState().items[0]).toEqual(
      expect.objectContaining({
        fileId: 'file-1',
        fileName: 'report.txt',
        sessionId: 'session-1',
        status: 'pending',
      })
    );
  });
});
