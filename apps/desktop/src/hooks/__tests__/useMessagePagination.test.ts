// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useMessagePagination } from '../chat/useMessagePagination';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';

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
});
