import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from './MessageInput';
import type { SlashCommand } from '@my-claudia/shared';

// Mock hooks
vi.mock('../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

// Mock chatStore
const mockSetDraft = vi.fn();
const mockClearDraft = vi.fn();
vi.mock('../../stores/chatStore', () => ({
  useChatStore: (selector: any) => {
    const state = {
      setDraft: mockSetDraft,
      clearDraft: mockClearDraft,
    };
    return selector(state);
  },
}));

// Mock api
vi.mock('../../services/api', () => ({
  listDirectory: vi.fn().mockResolvedValue({ entries: [] }),
}));

// Mock commands for testing
const mockCommands: SlashCommand[] = [
  { command: '/clear', description: 'Clear chat history', source: 'local' },
  { command: '/help', description: 'Show help information', source: 'local' },
  { command: '/model', description: 'Show current model info', source: 'local' },
  { command: '/compact', description: 'Compact conversation history', source: 'provider' },
  { command: '/config', description: 'Open Claude config', source: 'provider' },
  { command: '/cost', description: 'Show token usage and cost', source: 'provider' },
];

describe('MessageInput', () => {
  const defaultProps = {
    sessionId: 'session-1',
    onSend: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Basic rendering ─────────────────────────────────────────────────────

  it('renders textarea with default placeholder', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
  });

  it('renders textarea with custom placeholder', () => {
    render(<MessageInput {...defaultProps} placeholder="Custom placeholder" />);
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });

  it('renders the send button', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTitle('Send message (Enter)')).toBeInTheDocument();
  });

  it('renders the attachment button', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByTitle('Add attachment (images, files)')).toBeInTheDocument();
  });

  it('renders hint text', () => {
    render(<MessageInput {...defaultProps} />);
    expect(screen.getByText('Type / for commands')).toBeInTheDocument();
    expect(screen.getByText(/Paste images with (Cmd|Ctrl)\+V/)).toBeInTheDocument();
  });

  // ── Text input ────────────────────────────────────────────────────────────

  it('updates value when typing', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    expect(textarea).toHaveValue('Hello world');
  });

  it('persists draft to store on change', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'draft text' } });
    expect(mockSetDraft).toHaveBeenCalledWith('session-1', 'draft text');
  });

  it('renders with initialValue', () => {
    render(<MessageInput {...defaultProps} initialValue="Prefilled text" />);
    const textarea = screen.getByRole('textbox');
    expect((textarea as HTMLTextAreaElement).value).toBe('Prefilled text');
  });

  // ── Send behavior ─────────────────────────────────────────────────────────

  it('calls onSend when clicking send button with valid message', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    expect(onSend).toHaveBeenCalledWith('Hello', undefined);
    expect(textarea).toHaveValue('');
  });

  it('clears draft after sending', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(mockClearDraft).toHaveBeenCalledWith('session-1');
  });

  it('sends on Enter without modifier', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Test', undefined);
  });

  it('sends on Cmd+Enter', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledWith('Test message', undefined);
  });

  it('sends on Ctrl+Enter', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('Test message', undefined);
  });

  it('does not call onSend with empty message', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not call onSend with whitespace only message', () => {
    render(<MessageInput {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(screen.getByTitle('Send message (Enter)')).toBeDisabled();
  });

  it('does not send on Shift+Enter (allows newline)', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('trims whitespace from message before sending', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '  Hello world  ' } });
    fireEvent.click(screen.getByTitle('Send message (Enter)'));
    expect(onSend).toHaveBeenCalledWith('Hello world', undefined);
  });

  // ── Disabled state ────────────────────────────────────────────────────────

  it('disables textarea when disabled prop is true', () => {
    render(<MessageInput {...defaultProps} disabled />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeDisabled();
  });

  it('disables send button when disabled', () => {
    render(<MessageInput {...defaultProps} disabled />);
    expect(screen.getByTestId('send-button')).toBeDisabled();
  });

  it('does not send when disabled even with value', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} disabled />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  // ── Loading/cancel state ──────────────────────────────────────────────────

  it('shows cancel button when isLoading is true', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} isLoading />);
    expect(screen.getByTitle('Cancel (Esc)')).toBeInTheDocument();
    expect(screen.queryByTitle('Send message (Enter)')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} isLoading />);
    fireEvent.click(screen.getByTitle('Cancel (Esc)'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel on Escape when loading', () => {
    const onCancel = vi.fn();
    render(<MessageInput {...defaultProps} onCancel={onCancel} isLoading />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows send button when not loading', () => {
    render(<MessageInput {...defaultProps} onCancel={vi.fn()} />);
    expect(screen.getByTitle('Send message (Enter)')).toBeInTheDocument();
    expect(screen.queryByTitle('Cancel (Esc)')).not.toBeInTheDocument();
  });

  // ── Slash commands ────────────────────────────────────────────────────────

  describe('slash commands', () => {
    it('shows command suggestions when typing /', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      expect(screen.getByText('/help')).toBeInTheDocument();
    });

    it('filters commands based on input', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/cl' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      expect(screen.queryByText('/help')).not.toBeInTheDocument();
    });

    it('calls onCommand when slash command is sent', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/clear ' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onCommand).toHaveBeenCalledWith('/clear', '');
      expect(defaultProps.onSend).not.toHaveBeenCalled();
    });

    it('passes args to onCommand', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/model claude-3' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onCommand).toHaveBeenCalledWith('/model', 'claude-3');
    });

    it('hides command suggestions when input has space', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/clear ' } });
      expect(screen.queryByText('Clear chat history')).not.toBeInTheDocument();
    });

    it('shows provider commands in suggestions', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/co' } });
      expect(screen.getByText('/compact')).toBeInTheDocument();
      expect(screen.getByText('/config')).toBeInTheDocument();
      expect(screen.getByText('/cost')).toBeInTheDocument();
    });

    it('calls onCommand for provider commands', () => {
      const onCommand = vi.fn();
      render(<MessageInput {...defaultProps} onCommand={onCommand} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/cost ' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onCommand).toHaveBeenCalledWith('/cost', '');
    });

    it('shows no suggestions when commands prop is empty', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={[]} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.queryByText('/clear')).not.toBeInTheDocument();
    });

    it('navigates commands with arrow keys', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      fireEvent.keyDown(textarea, { key: 'ArrowDown' });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect((textarea as HTMLTextAreaElement).value).toContain('/help');
    });

    it('closes command suggestions on Escape', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      expect(screen.getByText('/clear')).toBeInTheDocument();
      fireEvent.keyDown(textarea, { key: 'Escape' });
      expect(screen.queryByText('/clear')).not.toBeInTheDocument();
    });

    it('selects command on click', () => {
      render(<MessageInput {...defaultProps} onCommand={vi.fn()} commands={mockCommands} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });
      fireEvent.click(screen.getByText('/help'));
      expect((textarea as HTMLTextAreaElement).value).toContain('/help');
    });
  });

  // ── Advanced mode ─────────────────────────────────────────────────────────

  describe('advanced mode', () => {
    it('renders larger textarea with resize in advanced mode', () => {
      render(<MessageInput {...defaultProps} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      expect(textarea.className).toContain('resize-y');
      expect(textarea.className).toContain('min-h-[160px]');
    });

    it('renders normal textarea when not in advanced mode', () => {
      render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      expect(textarea.className).toContain('min-h-12');
      expect(textarea.className).not.toContain('min-h-[160px]');
    });

    it('does not send on plain Enter in advanced mode', () => {
      const onSend = vi.fn();
      render(<MessageInput {...defaultProps} onSend={onSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'Test' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSend).not.toHaveBeenCalled();
    });

    it('sends on Cmd+Enter in advanced mode', () => {
      const onSend = vi.fn();
      render(<MessageInput {...defaultProps} onSend={onSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'Test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onSend).toHaveBeenCalledWith('Test', undefined);
    });

    it('inserts spaces on Tab in advanced mode', () => {
      render(<MessageInput {...defaultProps} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'hello' } });
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;
      fireEvent.keyDown(textarea, { key: 'Tab' });
      expect(textarea.value).toContain('  ');
    });

    it('shows advanced hint text', () => {
      render(<MessageInput {...defaultProps} advancedMode />);
      expect(screen.getByText(/Enter to send, Tab to indent/)).toBeInTheDocument();
    });

    it('shows send button with Cmd+Enter title', () => {
      render(<MessageInput {...defaultProps} advancedMode />);
      expect(screen.getByTitle(/Send message \((Cmd|Ctrl)\+Enter\)/)).toBeInTheDocument();
    });

    it('restores scrolling when switching to advanced mode', () => {
      const { rerender } = render(<MessageInput {...defaultProps} />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'short' } });
      expect(textarea.style.overflowY).toBe('hidden');
      rerender(<MessageInput {...defaultProps} advancedMode />);
      expect(textarea.style.overflowY).toBe('auto');
    });
  });

  // ── Attachments ───────────────────────────────────────────────────────────

  describe('attachments', () => {
    it('renders hidden file input', () => {
      const { container } = render(<MessageInput {...defaultProps} />);
      const fileInput = container.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
      expect(fileInput?.className).toContain('hidden');
    });

    it('send button is disabled when no text and no attachments', () => {
      render(<MessageInput {...defaultProps} />);
      expect(screen.getByTestId('send-button')).toBeDisabled();
    });

    it('shows attachment preview with initialAttachments', () => {
      const initialAttachments = [
        { id: 'att-1', type: 'image' as const, name: 'photo.png', data: 'data:image/png;base64,abc', mimeType: 'image/png' },
      ];
      render(<MessageInput {...defaultProps} initialAttachments={initialAttachments} />);
      expect(screen.getByLabelText('Remove attachment photo.png')).toBeInTheDocument();
    });

    it('removes attachment when remove button is clicked', () => {
      const initialAttachments = [
        { id: 'att-1', type: 'image' as const, name: 'photo.png', data: 'data:image/png;base64,abc', mimeType: 'image/png' },
      ];
      render(<MessageInput {...defaultProps} initialAttachments={initialAttachments} />);
      fireEvent.click(screen.getByLabelText('Remove attachment photo.png'));
      expect(screen.queryByLabelText('Remove attachment photo.png')).not.toBeInTheDocument();
    });

    it('can send with only attachments and no text', () => {
      const onSend = vi.fn();
      const initialAttachments = [
        { id: 'att-1', type: 'image' as const, name: 'photo.png', data: 'data:image/png;base64,abc', mimeType: 'image/png' },
      ];
      render(<MessageInput {...defaultProps} onSend={onSend} initialAttachments={initialAttachments} />);
      const sendBtn = screen.getByTestId('send-button');
      expect(sendBtn).not.toBeDisabled();
      fireEvent.click(sendBtn);
      expect(onSend).toHaveBeenCalledWith('', initialAttachments);
    });
  });

  // ── IME composition ───────────────────────────────────────────────────────

  it('does not send during IME composition', () => {
    const onSend = vi.fn();
    render(<MessageInput {...defaultProps} onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});
