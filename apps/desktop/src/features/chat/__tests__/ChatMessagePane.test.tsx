import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { ChatMessagePane } from '../ChatMessagePane';
import type { ToolCallState } from '../../../stores/chatStore';

const mockInteractionsState = {
  interactions: {} as Record<string, any>,
};

vi.mock('../../../stores/interactionStore', () => ({
  useInteractionStore: Object.assign(
    (selector: any) => selector(mockInteractionsState),
    { getState: () => mockInteractionsState },
  ),
}));

vi.mock('../MessageList', () => ({
  MessageList: ({ streamingToolCalls }: { streamingToolCalls?: ToolCallState[] }) => (
    <div data-testid="message-list">
      {streamingToolCalls?.map((toolCall) => (
        <div key={toolCall.id} data-testid="inline-tool-call">{toolCall.id}</div>
      ))}
    </div>
  ),
}));

vi.mock('../InteractionItem', () => ({
  InteractionItem: ({ interaction }: { interaction: any }) => (
    <div data-testid="global-prompt">{interaction.interactionId}</div>
  ),
}));

vi.mock('../LoadingIndicator', () => ({
  LoadingIndicator: () => <div data-testid="loading-indicator" />,
}));

vi.mock('../InlinePermissionRequest', () => ({
  InlinePermissionRequest: () => <div data-testid="permission-request" />,
}));

function makeAskUserQuestionToolCall(id: string): ToolCallState {
  return {
    id,
    toolName: 'AskUserQuestion',
    toolInput: {
      questions: [{ header: 'Scope', question: 'Proceed?', options: [] }],
    },
    status: 'running',
    isError: false,
  };
}

function renderPane(overrides: Partial<Parameters<typeof ChatMessagePane>[0]> = {}) {
  return render(
    <ChatMessagePane
      sessionId="s1"
      messagesEndRef={createRef<HTMLDivElement>()}
      messagesContainerRef={createRef<HTMLDivElement>()}
      initialLoadDone
      showScrollToBottom={false}
      scrollMetrics={{ scrollTop: 0, viewportHeight: 800 }}
      highlightedMessageId={null}
      loadError={null}
      sessionPagination={undefined}
      scrollToBottom={vi.fn()}
      jumpToBottomInstant={vi.fn()}
      loadMoreMessages={vi.fn()}
      handleScroll={vi.fn()}
      handleMessageWheel={vi.fn()}
      retryLoad={vi.fn()}
      sessionMessages={[]}
      lastSessionMessage={null}
      lastStreamingBlock={null}
      streamingContentSignature=""
      useStreamingSegmented
      sessionContentBlocks={[]}
      sessionToolCallHistory={[]}
      sessionToolCalls={[]}
      sessionHealth={null}
      isLoading={false}
      resendTargetMessageId={undefined}
      resendDisabled={false}
      onResendTarget={vi.fn()}
      onCancelRun={vi.fn()}
      permissionRequests={[]}
      onPermissionDecision={vi.fn()}
      {...overrides}
    />
  );
}

describe('ChatMessagePane', () => {
  beforeEach(() => {
    mockInteractionsState.interactions = {};
  });

  it('does not render a provider prompt globally when an AskUserQuestion tool call already owns it', () => {
    mockInteractionsState.interactions['ask-1'] = {
      type: 'interaction_prompt',
      interactionId: 'ask-1',
      sessionId: 's1',
      source: 'provider_native',
      createdAt: 1,
      title: 'Question',
      fields: [{ id: 'question_0', label: 'Proceed?', type: 'select', options: [] }],
      responseMode: 'prompt_answer',
      variant: 'question',
    };

    renderPane({
      sessionToolCallHistory: [makeAskUserQuestionToolCall('ask-1')],
    });

    expect(screen.getByTestId('inline-tool-call')).toHaveTextContent('ask-1');
    expect(screen.queryByTestId('global-prompt')).not.toBeInTheDocument();
  });

  it('keeps the global provider prompt as a fallback when no AskUserQuestion tool call owns it', () => {
    mockInteractionsState.interactions['ask-1'] = {
      type: 'interaction_prompt',
      interactionId: 'ask-1',
      sessionId: 's1',
      source: 'provider_native',
      createdAt: 1,
      title: 'Question',
      fields: [{ id: 'question_0', label: 'Proceed?', type: 'select', options: [] }],
      responseMode: 'prompt_answer',
      variant: 'question',
    };

    renderPane();

    expect(screen.getByTestId('global-prompt')).toHaveTextContent('ask-1');
  });
});
