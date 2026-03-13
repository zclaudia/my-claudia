import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { MessageWithToolCalls, ToolCallState } from '../../../stores/chatStore';
import type { ContentBlock } from '@my-claudia/shared';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
  isDarkTheme: () => true,
}));

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ sendMessage: vi.fn() }),
}));

vi.mock('../../../stores/filePushStore', () => ({
  useFilePushStore: Object.assign(
    (selector: any) => selector({ items: [] }),
    { getState: () => ({ items: [] }) },
  ),
}));

vi.mock('../../../stores/terminalStore', () => ({
  useTerminalStore: Object.assign(
    (selector: any) => selector({ terminals: {} }),
    { getState: () => ({ terminals: {} }) },
  ),
}));

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: Object.assign(
    (selector: any) => selector({ selectedSessionId: null, sessions: [] }),
    { getState: () => ({ selectedSessionId: null, sessions: [] }) },
  ),
}));

vi.mock('../../../stores/serverStore', () => ({
  useServerStore: Object.assign(
    (selector: any) => selector({}),
    { getState: () => ({ activeServerSupports: () => false }) },
  ),
}));

// Simplify markdown rendering
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('remark-gfm', () => ({ default: () => {} }));

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }: { children: string }) => <pre>{children}</pre>,
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

vi.mock('../ToolCallItem', () => ({
  ToolCallList: ({ toolCalls }: any) => (
    <div data-testid="tool-call-list">{toolCalls.length} tool calls</div>
  ),
  ToolCallItem: ({ toolCall }: any) => (
    <div data-testid="tool-call-item">{toolCall.id}</div>
  ),
}));

vi.mock('../FilePushNotification', () => ({
  FilePushCard: ({ item }: any) => <div data-testid="file-push-card">{item.fileName}</div>,
}));

vi.mock('../FilePreviewModal', () => ({
  FilePreviewModal: ({ onClose }: any) => <div data-testid="file-preview-modal"><button onClick={onClose}>close</button></div>,
}));

vi.mock('../../../services/fileUpload', () => ({
  downloadFile: vi.fn(),
}));

vi.mock('../FileReference', () => ({
  TextWithFileRefs: ({ text }: { text: string }) => <span>{text}</span>,
  MarkdownChildrenWithFileRefs: ({ children }: any) => <>{children}</>,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

// extractThinking replication for unit testing
function extractThinking(text: string): { thinking: string; content: string } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  const parts: string[] = [];
  let match;
  while ((match = thinkRegex.exec(text)) !== null) {
    parts.push(match[1].trim());
  }
  const content = text.replace(thinkRegex, '').trim();
  return { thinking: parts.join('\n\n'), content };
}

// Helper to create a message
function makeMessage(overrides: Partial<MessageWithToolCalls> & { id: string; role: 'user' | 'assistant' | 'system' }): MessageWithToolCalls {
  return {
    sessionId: 'session-1',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    id: 'tc-1',
    toolName: 'Read',
    toolInput: { file_path: '/test.ts' },
    status: 'completed',
    result: 'content',
    isError: false,
    ...overrides,
  };
}

// ── extractThinking unit tests ─────────────────────────────────────────────────

describe('extractThinking', () => {
  it('returns empty thinking when no think tags present', () => {
    const result = extractThinking('Hello world');
    expect(result.thinking).toBe('');
    expect(result.content).toBe('Hello world');
  });

  it('extracts a single thinking block', () => {
    const result = extractThinking('<think>I need to consider this</think>Here is my answer');
    expect(result.thinking).toBe('I need to consider this');
    expect(result.content).toBe('Here is my answer');
  });

  it('extracts multiple thinking blocks', () => {
    const result = extractThinking(
      '<think>First thought</think>Some text<think>Second thought</think>More text'
    );
    expect(result.thinking).toBe('First thought\n\nSecond thought');
    expect(result.content).toBe('Some textMore text');
  });

  it('handles multiline thinking content', () => {
    const result = extractThinking('<think>Line 1\nLine 2\nLine 3</think>Answer');
    expect(result.thinking).toBe('Line 1\nLine 2\nLine 3');
    expect(result.content).toBe('Answer');
  });

  it('trims whitespace inside think tags', () => {
    const result = extractThinking('<think>  spaced out  </think>Content');
    expect(result.thinking).toBe('spaced out');
    expect(result.content).toBe('Content');
  });

  it('trims the remaining content', () => {
    const result = extractThinking('  <think>thought</think>  ');
    expect(result.thinking).toBe('thought');
    expect(result.content).toBe('');
  });

  it('handles empty think tags', () => {
    const result = extractThinking('<think></think>Content here');
    expect(result.thinking).toBe('');
    expect(result.content).toBe('Content here');
  });

  it('handles text with only think tags', () => {
    const result = extractThinking('<think>Only thinking</think>');
    expect(result.thinking).toBe('Only thinking');
    expect(result.content).toBe('');
  });
});

// ── MessageList component tests ────────────────────────────────────────────────

let MessageList: typeof import('../MessageList').MessageList;

beforeEach(async () => {
  const mod = await import('../MessageList');
  MessageList = mod.MessageList;
});

afterEach(() => {
  cleanup();
});

describe('MessageList', () => {
  // ── Basic rendering ──────────────────────────────────────────────────────

  it('returns null when messages array is empty', () => {
    const { container } = render(<MessageList messages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a user message', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello there' }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Hello there')).toBeInTheDocument();
  });

  it('renders an assistant message', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'assistant', content: 'Hi, how can I help?' }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Hi, how can I help?')).toBeInTheDocument();
  });

  it('renders multiple messages in order', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Question' }),
      makeMessage({ id: 'msg-2', role: 'assistant', content: 'Answer' }),
      makeMessage({ id: 'msg-3', role: 'user', content: 'Follow up' }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Question')).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Follow up')).toBeInTheDocument();
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(3);
  });

  it('handles null/undefined messages gracefully', () => {
    const { container } = render(<MessageList messages={undefined as any} />);
    expect(container.firstChild).toBeNull();
  });

  // ── Filtering ─────────────────────────────────────────────────────────────

  it('filters out empty assistant messages', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
      makeMessage({ id: 'msg-2', role: 'assistant', content: '' }),
      makeMessage({ id: 'msg-3', role: 'assistant', content: 'Real response' }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Real response')).toBeInTheDocument();
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(2);
  });

  it('filters out empty user messages', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: '' }),
      makeMessage({ id: 'msg-2', role: 'user', content: '   ' }),
      makeMessage({ id: 'msg-3', role: 'assistant', content: 'Response' }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Response')).toBeInTheDocument();
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(1);
  });

  it('filters whitespace-only assistant messages', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'assistant', content: '   \n\t  ' }),
      makeMessage({ id: 'msg-2', role: 'user', content: 'Hello' }),
    ];
    render(<MessageList messages={messages} />);
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(1);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('keeps user messages with JSON MessageInput that has text', () => {
    const content = JSON.stringify({ text: 'Structured message', attachments: [] });
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Structured message')).toBeInTheDocument();
  });

  it('filters out user messages with empty JSON MessageInput text and no attachments', () => {
    const content = JSON.stringify({ text: '', attachments: [] });
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content }),
      makeMessage({ id: 'msg-2', role: 'assistant', content: 'Response' }),
    ];
    render(<MessageList messages={messages} />);
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(1);
  });

  it('keeps user messages with attachments even if text is empty', () => {
    const content = JSON.stringify({
      text: '',
      attachments: [{ fileId: 'f1', name: 'img.png', type: 'image' }],
    });
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content }),
    ];
    render(<MessageList messages={messages} />);
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(1);
  });

  it('keeps assistant messages with tool calls even if content is empty', () => {
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: '',
        toolCalls: [makeToolCall({ id: 'tc-1' })],
      }),
    ];
    render(<MessageList messages={messages} />);
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(1);
  });

  it('keeps assistant messages with content blocks even if content is empty', () => {
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: '',
        contentBlocks: [{ type: 'text', content: 'block text' }],
      }),
    ];
    render(<MessageList messages={messages} />);
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(1);
  });

  it('keeps system messages regardless of content', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'system', content: 'System notification' }),
    ];
    render(<MessageList messages={messages} />);
    const messageList = screen.getByTestId('message-list');
    expect(messageList.children.length).toBe(1);
  });

  it('handles non-JSON user content as plain text', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Not {valid} JSON' }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Not {valid} JSON')).toBeInTheDocument();
  });

  // ── data-role attribute ───────────────────────────────────────────────────

  it('assigns data-role attribute to user messages', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'User msg' }),
    ];
    render(<MessageList messages={messages} />);
    const el = screen.getByText('User msg').closest('[data-role]');
    expect(el?.getAttribute('data-role')).toBe('user');
  });

  it('assigns data-role attribute to assistant messages', () => {
    const messages = [
      makeMessage({ id: 'msg-2', role: 'assistant', content: 'Assistant msg' }),
    ];
    render(<MessageList messages={messages} />);
    const el = screen.getByText('Assistant msg').closest('[data-role]');
    expect(el?.getAttribute('data-role')).toBe('assistant');
  });

  it('assigns data-role attribute to system messages', () => {
    const messages = [
      makeMessage({ id: 'msg-3', role: 'system', content: 'System msg' }),
    ];
    render(<MessageList messages={messages} />);
    const el = screen.getByText('System msg').closest('[data-role]');
    expect(el?.getAttribute('data-role')).toBe('system');
  });

  // ── Timestamps ────────────────────────────────────────────────────────────

  it('displays timestamp for user messages', () => {
    const now = new Date('2024-06-15T14:30:00Z');
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello', createdAt: now.getTime() }),
    ];
    render(<MessageList messages={messages} />);
    const timeEl = screen.getByText('Hello').closest('[data-role]')?.querySelector('.opacity-50');
    expect(timeEl).toBeTruthy();
    expect(timeEl?.textContent).toBeTruthy();
  });

  it('displays timestamp for assistant messages', () => {
    const now = new Date('2024-06-15T14:30:00Z');
    const messages = [
      makeMessage({ id: 'msg-1', role: 'assistant', content: 'Reply', createdAt: now.getTime() }),
    ];
    render(<MessageList messages={messages} />);
    const timeEl = screen.getByText('Reply').closest('[data-role]')?.querySelector('.opacity-50');
    expect(timeEl).toBeTruthy();
  });

  // ── User messages with styling ────────────────────────────────────────────

  it('user message bubble is right-aligned (items-end)', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
    ];
    render(<MessageList messages={messages} />);
    const roleDiv = screen.getByText('Hello').closest('[data-role="user"]');
    expect(roleDiv?.className).toContain('items-end');
  });

  it('assistant message bubble is left-aligned (items-start)', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'assistant', content: 'Hi' }),
    ];
    render(<MessageList messages={messages} />);
    const roleDiv = screen.getByText('Hi').closest('[data-role="assistant"]');
    expect(roleDiv?.className).toContain('items-start');
  });

  it('system messages have reduced opacity', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'system', content: 'System notice' }),
    ];
    render(<MessageList messages={messages} />);
    const roleDiv = screen.getByText('System notice').closest('[data-role="system"]');
    expect(roleDiv?.className).toContain('opacity-60');
  });

  // ── Tool call display (mocked ToolCallList) ───────────────────────────────

  it('renders ToolCallList for assistant messages with tool calls (legacy path)', () => {
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: 'Done',
        toolCalls: [makeToolCall({ id: 'tc-1' }), makeToolCall({ id: 'tc-2' })],
      }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByTestId('tool-call-list')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-list').textContent).toContain('2 tool calls');
  });

  it('does not render ToolCallList for user messages', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.queryByTestId('tool-call-list')).not.toBeInTheDocument();
  });

  // ── Segmented content (contentBlocks + toolCalls) ─────────────────────────

  it('renders segmented content when assistant has contentBlocks and toolCalls', () => {
    const contentBlocks: ContentBlock[] = [
      { type: 'text', content: 'Thinking about this...' },
      { type: 'tool_use', toolUseId: 'tc-1', content: '' },
      { type: 'text', content: 'Final answer here.' },
    ];
    const toolCalls: ToolCallState[] = [
      makeToolCall({ id: 'tc-1', toolName: 'Read' }),
    ];
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: 'Thinking about this...\nFinal answer here.',
        contentBlocks,
        toolCalls,
      }),
    ];
    render(<MessageList messages={messages} />);
    // The segmented path renders tool-call-item instead of tool-call-list
    expect(screen.getByTestId('tool-call-item')).toBeInTheDocument();
    expect(screen.getByTestId('tool-call-item').textContent).toContain('tc-1');
  });

  // ── FilePush messages ─────────────────────────────────────────────────────

  it('renders FilePushCard for messages with filePush metadata', () => {
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: 'file push',
        metadata: {
          filePush: {
            fileId: 'fp-1',
            fileName: 'report.pdf',
            mimeType: 'application/pdf',
            fileSize: 1024,
            description: 'A report',
            autoDownload: false,
          },
        },
      } as any),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByTestId('file-push-card')).toBeInTheDocument();
    expect(screen.getByTestId('file-push-card').textContent).toContain('report.pdf');
  });

  // ── Thinking blocks ───────────────────────────────────────────────────────

  it('renders thinking block for assistant messages with <think> tags', () => {
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: '<think>Let me think about this</think>Here is my answer.',
      }),
    ];
    render(<MessageList messages={messages} />);
    // The thinking block has a "Thinking" label
    expect(screen.getByText('Thinking')).toBeInTheDocument();
    // The main answer content renders via markdown mock
    expect(screen.getByText('Here is my answer.')).toBeInTheDocument();
  });

  it('thinking block shows line count', () => {
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: '<think>Line 1\nLine 2\nLine 3</think>Answer.',
      }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('3 lines')).toBeInTheDocument();
  });

  it('thinking block shows singular line count', () => {
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: '<think>Single line</think>Answer.',
      }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('thinking block is collapsible — click to expand', () => {
    const messages = [
      makeMessage({
        id: 'msg-1',
        role: 'assistant',
        content: '<think>Deep thought\nAnother line\nThird line\nFourth line</think>Answer.',
      }),
    ];
    render(<MessageList messages={messages} />);

    // Click the "Thinking" button to expand
    const thinkingButton = screen.getByText('Thinking').closest('button')!;
    fireEvent.click(thinkingButton);

    // After expanding, full content should be visible
    const container = screen.getByText('Thinking').closest('.mb-2')!;
    expect(container.textContent).toContain('Deep thought');
    expect(container.textContent).toContain('Fourth line');
  });

  // ── Resend button ─────────────────────────────────────────────────────────

  it('shows resend button when resendTargetMessageId matches a user message', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
    ];
    const onResend = vi.fn();
    render(
      <MessageList
        messages={messages}
        resendTargetMessageId="msg-1"
        onResendTarget={onResend}
      />
    );
    const resendBtn = screen.getByText('Resend');
    expect(resendBtn).toBeInTheDocument();
  });

  it('resend button calls onResendTarget when clicked', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
    ];
    const onResend = vi.fn();
    render(
      <MessageList
        messages={messages}
        resendTargetMessageId="msg-1"
        onResendTarget={onResend}
      />
    );
    fireEvent.click(screen.getByText('Resend'));
    expect(onResend).toHaveBeenCalled();
  });

  it('resend button is disabled when resendDisabled is true', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
    ];
    render(
      <MessageList
        messages={messages}
        resendTargetMessageId="msg-1"
        onResendTarget={vi.fn()}
        resendDisabled
      />
    );
    const resendBtn = screen.getByText('Resend');
    expect(resendBtn).toBeDisabled();
  });

  it('does not show resend button when resendTargetMessageId does not match', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
    ];
    render(
      <MessageList
        messages={messages}
        resendTargetMessageId="msg-other"
        onResendTarget={vi.fn()}
      />
    );
    expect(screen.queryByText('Resend')).not.toBeInTheDocument();
  });

  // ── Structured user input (JSON MessageInput) ─────────────────────────────

  it('renders structured user message with text from JSON', () => {
    const content = JSON.stringify({ text: 'Hello from JSON', attachments: [] });
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Hello from JSON')).toBeInTheDocument();
  });

  it('renders user message attachments', () => {
    const content = JSON.stringify({
      text: 'Check this image',
      attachments: [{ fileId: 'f1', name: 'photo.png', type: 'image' }],
    });
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('Check this image')).toBeInTheDocument();
    // Attachment presence: image attachment renders a container with the name
    expect(screen.getByText('photo.png')).toBeInTheDocument();
  });

  // ── Markdown rendering ────────────────────────────────────────────────────

  it('renders assistant messages via ReactMarkdown mock', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'assistant', content: 'Hello **bold**' }),
    ];
    render(<MessageList messages={messages} />);
    // The markdown mock wraps content in a div with data-testid="markdown"
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    expect(screen.getByTestId('markdown').textContent).toContain('Hello **bold**');
  });

  // ── Non-virtualised list structure ────────────────────────────────────────

  it('renders with data-testid="message-list" wrapper', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Hi' }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByTestId('message-list')).toBeInTheDocument();
  });

  it('renders correct number of children in message list', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'A' }),
      makeMessage({ id: 'msg-2', role: 'assistant', content: 'B' }),
      makeMessage({ id: 'msg-3', role: 'user', content: 'C' }),
      makeMessage({ id: 'msg-4', role: 'assistant', content: 'D' }),
    ];
    render(<MessageList messages={messages} />);
    const list = screen.getByTestId('message-list');
    expect(list.children.length).toBe(4);
  });

  // ── Streaming content blocks ──────────────────────────────────────────────

  it('passes streaming blocks to the last assistant message', () => {
    const streamingBlocks: ContentBlock[] = [
      { type: 'text', content: 'Streaming text...' },
      { type: 'tool_use', toolUseId: 'stc-1', content: '' },
    ];
    const streamingToolCalls: ToolCallState[] = [
      makeToolCall({ id: 'stc-1', toolName: 'Bash', status: 'running' }),
    ];
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content: 'Do something' }),
      makeMessage({
        id: 'msg-2',
        role: 'assistant',
        content: 'Working...',
        contentBlocks: [{ type: 'text', content: 'Working...' }],
        toolCalls: [makeToolCall({ id: 'stc-1' })],
      }),
    ];
    render(
      <MessageList
        messages={messages}
        streamingContentBlocks={streamingBlocks}
        streamingToolCalls={streamingToolCalls}
      />
    );
    // The streaming tool call should render via segmented content
    expect(screen.getByTestId('tool-call-item')).toBeInTheDocument();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles a single system message', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'system', content: 'Task started' }),
    ];
    render(<MessageList messages={messages} />);
    const list = screen.getByTestId('message-list');
    expect(list.children.length).toBe(1);
  });

  it('handles many messages without virtualization (below threshold)', () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      makeMessage({ id: `msg-${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` })
    );
    render(<MessageList messages={messages} />);
    const list = screen.getByTestId('message-list');
    expect(list.children.length).toBe(50);
  });

  it('handles messages array with only filtered-out items', () => {
    const messages = [
      makeMessage({ id: 'msg-1', role: 'assistant', content: '' }),
      makeMessage({ id: 'msg-2', role: 'user', content: '  ' }),
    ];
    const { container } = render(<MessageList messages={messages} />);
    expect(container.firstChild).toBeNull();
  });

  it('file attachment type renders fallback for non-image types', () => {
    const content = JSON.stringify({
      text: 'here',
      attachments: [{ fileId: 'f1', name: 'data.csv', type: 'file' }],
    });
    const messages = [
      makeMessage({ id: 'msg-1', role: 'user', content }),
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText('data.csv')).toBeInTheDocument();
  });
});
