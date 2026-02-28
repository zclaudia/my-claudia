import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessageList } from './MessageList';
import type { Message } from '@my-claudia/shared';
import { ThemeProvider } from '../../contexts/ThemeContext';
import type { ReactElement } from 'react';

// Mock ConnectionContext so CodeBlock doesn't throw
vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ sendMessage: vi.fn() }),
}));

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockWriteText },
  writable: true,
});

// Helper to render with ThemeProvider (needed for CodeBlock's useTheme)
function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('MessageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Test message',
    createdAt: Date.now(),
    ...overrides,
  });

  it('renders nothing when no messages', () => {
    const { container } = render(<MessageList messages={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders user message on the right side', () => {
    const messages = [createMessage({ role: 'user', content: 'Hello' })];
    render(<MessageList messages={messages} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    const container = screen.getByText('Hello').closest('.flex');
    expect(container).toHaveClass('items-end');
  });

  it('renders assistant message on the left side', () => {
    const messages = [createMessage({ role: 'assistant', content: 'Hi there!' })];
    render(<MessageList messages={messages} />);

    expect(screen.getByText('Hi there!')).toBeInTheDocument();
    const container = screen.getByText('Hi there!').closest('.flex');
    expect(container).toHaveClass('items-start');
  });

  it('renders system message with reduced opacity', () => {
    const messages = [createMessage({ role: 'system', content: 'System notice' })];
    render(<MessageList messages={messages} />);

    expect(screen.getByText('System notice')).toBeInTheDocument();
    const container = screen.getByText('System notice').closest('.flex');
    expect(container).toHaveClass('opacity-60');
  });

  it('renders multiple messages in order', () => {
    const messages = [
      createMessage({ id: '1', role: 'user', content: 'First' }),
      createMessage({ id: '2', role: 'assistant', content: 'Second' }),
      createMessage({ id: '3', role: 'user', content: 'Third' }),
    ];
    render(<MessageList messages={messages} />);

    const messageElements = screen.getAllByText(/First|Second|Third/);
    expect(messageElements).toHaveLength(3);
    expect(messageElements[0]).toHaveTextContent('First');
    expect(messageElements[1]).toHaveTextContent('Second');
    expect(messageElements[2]).toHaveTextContent('Third');
  });

  it('displays message timestamp', () => {
    const timestamp = new Date('2024-01-15T10:30:00').getTime();
    const messages = [createMessage({ createdAt: timestamp })];
    render(<MessageList messages={messages} />);

    // The exact format depends on locale, so we check for time pattern
    expect(screen.getByText(/\d{1,2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });

  describe('Markdown rendering', () => {
    it('renders markdown in assistant messages', () => {
      const messages = [
        createMessage({
          role: 'assistant',
          content: '**Bold** and *italic* text',
        }),
      ];
      render(<MessageList messages={messages} />);

      const bold = screen.getByText('Bold');
      expect(bold.tagName).toBe('STRONG');

      const italic = screen.getByText('italic');
      expect(italic.tagName).toBe('EM');
    });

    it('renders code blocks with syntax highlighting', () => {
      const messages = [
        createMessage({
          role: 'assistant',
          content: '```javascript\nconst x = 1;\n```',
        }),
      ];
      renderWithTheme(<MessageList messages={messages} />);

      expect(screen.getByText('javascript')).toBeInTheDocument();
      expect(screen.getByText(/const/)).toBeInTheDocument();
    });

    it('renders inline code', () => {
      const messages = [
        createMessage({
          role: 'assistant',
          content: 'Use the `console.log` function',
        }),
      ];
      render(<MessageList messages={messages} />);

      const code = screen.getByText('console.log');
      expect(code.tagName).toBe('CODE');
    });

    it('renders links with proper attributes', () => {
      const messages = [
        createMessage({
          role: 'assistant',
          content: 'Check out [this link](https://example.com)',
        }),
      ];
      render(<MessageList messages={messages} />);

      const link = screen.getByText('this link');
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders tables', () => {
      const messages = [
        createMessage({
          role: 'assistant',
          content: '| Header |\n| --- |\n| Cell |',
        }),
      ];
      render(<MessageList messages={messages} />);

      expect(screen.getByText('Header')).toBeInTheDocument();
      expect(screen.getByText('Cell')).toBeInTheDocument();
    });
  });

  describe('Code block copy functionality', () => {
    it('shows copy button', () => {
      const messages = [
        createMessage({
          role: 'assistant',
          content: '```js\nconst x = 1;\n```',
        }),
      ];
      renderWithTheme(<MessageList messages={messages} />);

      const copyButton = screen.getByText('Copy code');
      expect(copyButton).toBeInTheDocument();
    });

    it('copies code to clipboard when copy button clicked', async () => {
      const messages = [
        createMessage({
          role: 'assistant',
          content: '```js\nconst x = 1;\n```',
        }),
      ];
      renderWithTheme(<MessageList messages={messages} />);

      const copyButton = screen.getByText('Copy code');
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith('const x = 1;');
      });
    });

    it('shows "Copied!" after clicking copy', async () => {
      const messages = [
        createMessage({
          role: 'assistant',
          content: '```js\nconst x = 1;\n```',
        }),
      ];
      renderWithTheme(<MessageList messages={messages} />);

      const copyButton = screen.getByText('Copy code');
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });
    });
  });

  describe('User messages', () => {
    it('preserves whitespace in user messages', () => {
      const messages = [
        createMessage({
          role: 'user',
          content: 'Line 1\nLine 2',
        }),
      ];
      render(<MessageList messages={messages} />);

      const messageElement = screen.getByText(/Line 1/);
      expect(messageElement).toHaveClass('whitespace-pre-wrap');
    });

    it('does not render markdown in user messages', () => {
      const messages = [
        createMessage({
          role: 'user',
          content: '**Not bold**',
        }),
      ];
      render(<MessageList messages={messages} />);

      // Should render as plain text, not as bold
      expect(screen.getByText('**Not bold**')).toBeInTheDocument();
      expect(screen.queryByText('Not bold')).not.toBeInTheDocument();
    });
  });
});
