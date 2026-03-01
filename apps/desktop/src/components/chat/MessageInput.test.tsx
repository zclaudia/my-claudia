import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from './MessageInput';
import type { SlashCommand } from '@my-claudia/shared';

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
  const mockOnSend = vi.fn();
  const mockOnCancel = vi.fn();
  const mockOnCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders textarea with default placeholder', () => {
    render(<MessageInput onSend={mockOnSend} />);
    expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
  });

  it('renders textarea with custom placeholder', () => {
    render(<MessageInput onSend={mockOnSend} placeholder="Custom placeholder" />);
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });

  it('updates value when typing', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    expect(textarea).toHaveValue('Hello world');
  });

  it('calls onSend when clicking send button with valid message', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    const sendButton = screen.getByTitle('Send message (Enter)');
    fireEvent.click(sendButton);

    expect(mockOnSend).toHaveBeenCalledWith('Hello', undefined);
    expect(textarea).toHaveValue('');
  });

  it('does not call onSend with empty message', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const sendButton = screen.getByTitle('Send message (Enter)');
    fireEvent.click(sendButton);

    expect(mockOnSend).not.toHaveBeenCalled();
  });

  it('does not call onSend with whitespace only message', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '   ' } });

    const sendButton = screen.getByTitle('Send message (Enter)');
    expect(sendButton).toBeDisabled();
  });

  it('disables textarea when disabled prop is true', () => {
    render(<MessageInput onSend={mockOnSend} disabled />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    expect(textarea).toBeDisabled();
  });

  it('sends message on Cmd+Enter', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    expect(mockOnSend).toHaveBeenCalledWith('Test message', undefined);
  });

  it('sends message on Ctrl+Enter', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    expect(mockOnSend).toHaveBeenCalledWith('Test message', undefined);
  });

  it('shows cancel button when isLoading is true', () => {
    render(
      <MessageInput
        onSend={mockOnSend}
        onCancel={mockOnCancel}
        isLoading
      />
    );

    expect(screen.getByTitle('Cancel (Esc)')).toBeInTheDocument();
    expect(screen.queryByTitle('Send message (Enter)')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    render(
      <MessageInput
        onSend={mockOnSend}
        onCancel={mockOnCancel}
        isLoading
      />
    );

    const cancelButton = screen.getByTitle('Cancel (Esc)');
    fireEvent.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('shows send button when not loading', () => {
    render(<MessageInput onSend={mockOnSend} onCancel={mockOnCancel} />);

    expect(screen.getByTitle('Send message (Enter)')).toBeInTheDocument();
    expect(screen.queryByTitle('Cancel (Esc)')).not.toBeInTheDocument();
  });

  it('trims whitespace from message before sending', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: '  Hello world  ' } });

    const sendButton = screen.getByTitle('Send message (Enter)');
    fireEvent.click(sendButton);

    expect(mockOnSend).toHaveBeenCalledWith('Hello world', undefined);
  });

  it('sends on Enter without modifier', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(mockOnSend).toHaveBeenCalledWith('Test', undefined);
  });

  it('does not send on Shift+Enter (allows newline)', () => {
    render(<MessageInput onSend={mockOnSend} />);

    const textarea = screen.getByPlaceholderText(/Type a message/);
    fireEvent.change(textarea, { target: { value: 'Test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(mockOnSend).not.toHaveBeenCalled();
  });

  // Slash command tests
  describe('slash commands', () => {
    it('shows command suggestions when typing /', () => {
      render(<MessageInput onSend={mockOnSend} onCommand={mockOnCommand} commands={mockCommands} />);

      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });

      expect(screen.getByText('/clear')).toBeInTheDocument();
      expect(screen.getByText('/help')).toBeInTheDocument();
    });

    it('filters commands based on input', () => {
      render(<MessageInput onSend={mockOnSend} onCommand={mockOnCommand} commands={mockCommands} />);

      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/cl' } });

      expect(screen.getByText('/clear')).toBeInTheDocument();
      expect(screen.queryByText('/help')).not.toBeInTheDocument();
    });

    it('calls onCommand when slash command is sent', () => {
      render(<MessageInput onSend={mockOnSend} onCommand={mockOnCommand} commands={mockCommands} />);

      const textarea = screen.getByPlaceholderText(/Type a message/);
      // Type the command with a space to close the suggestion menu
      fireEvent.change(textarea, { target: { value: '/clear ' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

      expect(mockOnCommand).toHaveBeenCalledWith('/clear', '');
      expect(mockOnSend).not.toHaveBeenCalled();
    });

    it('passes args to onCommand', () => {
      render(<MessageInput onSend={mockOnSend} onCommand={mockOnCommand} commands={mockCommands} />);

      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/model claude-3' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

      expect(mockOnCommand).toHaveBeenCalledWith('/model', 'claude-3');
    });

    it('hides command suggestions when input has space', () => {
      render(<MessageInput onSend={mockOnSend} onCommand={mockOnCommand} commands={mockCommands} />);

      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/clear ' } });

      expect(screen.queryByText('Clear chat history')).not.toBeInTheDocument();
    });

    it('shows provider commands in suggestions', () => {
      render(<MessageInput onSend={mockOnSend} onCommand={mockOnCommand} commands={mockCommands} />);

      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/co' } });

      // Should show both /compact and /config and /cost
      expect(screen.getByText('/compact')).toBeInTheDocument();
      expect(screen.getByText('/config')).toBeInTheDocument();
      expect(screen.getByText('/cost')).toBeInTheDocument();
    });

    it('calls onCommand for provider commands', () => {
      render(<MessageInput onSend={mockOnSend} onCommand={mockOnCommand} commands={mockCommands} />);

      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/cost ' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

      expect(mockOnCommand).toHaveBeenCalledWith('/cost', '');
    });

    it('shows no suggestions when commands prop is empty', () => {
      render(<MessageInput onSend={mockOnSend} onCommand={mockOnCommand} commands={[]} />);

      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: '/' } });

      expect(screen.queryByText('/clear')).not.toBeInTheDocument();
      expect(screen.queryByText('/help')).not.toBeInTheDocument();
    });
  });

  // Advanced mode tests
  describe('advanced mode', () => {
    it('renders larger textarea with resize in advanced mode', () => {
      render(<MessageInput onSend={mockOnSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      expect(textarea.className).toContain('resize-y');
      expect(textarea.className).toContain('min-h-[160px]');
    });

    it('renders normal textarea without resize when not in advanced mode', () => {
      render(<MessageInput onSend={mockOnSend} />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      expect(textarea.className).toContain('resize-none');
      expect(textarea.className).not.toContain('resize-y');
    });

    it('does not send on plain Enter in advanced mode (desktop)', () => {
      render(<MessageInput onSend={mockOnSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'Test' } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(mockOnSend).not.toHaveBeenCalled();
    });

    it('sends on Cmd+Enter in advanced mode', () => {
      render(<MessageInput onSend={mockOnSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'Test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(mockOnSend).toHaveBeenCalledWith('Test', undefined);
    });

    it('sends on Ctrl+Enter in advanced mode', () => {
      render(<MessageInput onSend={mockOnSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(textarea, { target: { value: 'Test' } });
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(mockOnSend).toHaveBeenCalledWith('Test', undefined);
    });

    it('inserts spaces on Tab in advanced mode', () => {
      render(<MessageInput onSend={mockOnSend} advancedMode />);
      const textarea = screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'hello' } });
      // Set cursor position
      textarea.selectionStart = 5;
      textarea.selectionEnd = 5;
      fireEvent.keyDown(textarea, { key: 'Tab' });
      // Tab should be prevented (not leave the textarea)
      // The value should now contain the spaces
      expect(textarea.value).toContain('  ');
    });

    it('shows advanced hint text in advanced mode', () => {
      render(<MessageInput onSend={mockOnSend} advancedMode />);
      expect(screen.getByText(/Enter to send, Tab to indent/)).toBeInTheDocument();
    });

    it('shows send button with Cmd+Enter title in advanced mode', () => {
      render(<MessageInput onSend={mockOnSend} advancedMode />);
      expect(screen.getByTitle(/Send message \((Cmd|Ctrl)\+Enter\)/)).toBeInTheDocument();
    });
  });

  // Attachment tests
  describe('attachments', () => {
    it('renders attachment button', () => {
      render(<MessageInput onSend={mockOnSend} />);
      expect(screen.getByTitle('Add attachment (images, files)')).toBeInTheDocument();
    });

    it('shows hint text', () => {
      render(<MessageInput onSend={mockOnSend} />);
      expect(screen.getByText('Type / for commands')).toBeInTheDocument();
      expect(screen.getByText(/Paste images with (Cmd|Ctrl)\+V/)).toBeInTheDocument();
    });
  });
});
