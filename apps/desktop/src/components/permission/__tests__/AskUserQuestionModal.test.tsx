import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AskUserQuestionModal } from '../AskUserQuestionModal';

describe('AskUserQuestionModal', () => {
  const mockOnAnswer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const defaultRequest = {
    requestId: 'ask-1',
    questions: [{
      question: 'Which framework should we use?',
      header: 'Framework',
      options: [
        { label: 'React', description: 'Popular UI library' },
        { label: 'Vue', description: 'Progressive framework' },
      ],
      multiSelect: false,
    }],
  };

  it('returns null when request is null', () => {
    const { container } = render(
      <AskUserQuestionModal request={null} onAnswer={mockOnAnswer} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders "Claude has a question" header', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    expect(screen.getByText('Claude has a question')).toBeInTheDocument();
  });

  it('shows question text and header chip', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    expect(screen.getByText('Framework')).toBeInTheDocument();
    expect(screen.getByText('Which framework should we use?')).toBeInTheDocument();

    // Header chip has bg-primary/20 styling
    const chip = screen.getByText('Framework');
    expect(chip.tagName).toBe('SPAN');
    expect(chip.className).toContain('bg-primary/20');
  });

  it('shows all option labels', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Vue')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('shows option descriptions when provided', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    expect(screen.getByText('Popular UI library')).toBeInTheDocument();
    expect(screen.getByText('Progressive framework')).toBeInTheDocument();
  });

  it('single select: click option makes it checked (radio)', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    const radios = screen.getAllByRole('radio');
    // Options: React, Vue, Other => 3 radios
    expect(radios).toHaveLength(3);

    fireEvent.click(radios[0]); // React
    expect(radios[0]).toBeChecked();
  });

  it('single select: clicking another option deselects previous one', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    const radios = screen.getAllByRole('radio');

    fireEvent.click(radios[0]); // React
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();

    fireEvent.click(radios[1]); // Vue
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).toBeChecked();
  });

  it('multi select: clicking options toggles them independently (checkboxes)', () => {
    const multiRequest = {
      requestId: 'ask-2',
      questions: [{
        question: 'Which languages do you know?',
        header: 'Languages',
        options: [
          { label: 'TypeScript', description: 'Typed JS' },
          { label: 'Python', description: 'General purpose' },
          { label: 'Rust', description: 'Systems language' },
        ],
        multiSelect: true,
      }],
    };

    render(
      <AskUserQuestionModal request={multiRequest} onAnswer={mockOnAnswer} />
    );
    const checkboxes = screen.getAllByRole('checkbox');
    // Options: TypeScript, Python, Rust, Other => 4 checkboxes
    expect(checkboxes).toHaveLength(4);

    fireEvent.click(checkboxes[0]); // TypeScript
    fireEvent.click(checkboxes[2]); // Rust
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(checkboxes[2]).toBeChecked();

    // Toggle off TypeScript
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[2]).toBeChecked();
  });

  it('"Other" option: clicking "Other" radio shows text input', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    const radios = screen.getAllByRole('radio');
    const otherRadio = radios[2]; // last radio is "Other"

    // No text input initially
    expect(screen.queryByPlaceholderText('Type your answer...')).not.toBeInTheDocument();

    fireEvent.click(otherRadio);
    expect(otherRadio).toBeChecked();
    expect(screen.getByPlaceholderText('Type your answer...')).toBeInTheDocument();
  });

  it('"Other" text input works', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[2]); // Other

    const input = screen.getByPlaceholderText('Type your answer...');
    fireEvent.change(input, { target: { value: 'Svelte' } });
    expect(input).toHaveValue('Svelte');
  });

  it('submit button is disabled initially (no answer selected)', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    const submitButton = screen.getByText('Submit');
    expect(submitButton).toBeDisabled();
  });

  it('submit button is enabled after selecting an option', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]); // React

    const submitButton = screen.getByText('Submit');
    expect(submitButton).not.toBeDisabled();
  });

  it('submit calls onAnswer with formatted answer text', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]); // React

    fireEvent.click(screen.getByText('Submit'));

    expect(mockOnAnswer).toHaveBeenCalledWith(
      'ask-1',
      'Q: Which framework should we use?\nA: React'
    );
  });

  it('skip calls onAnswer with decline message', () => {
    render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );

    fireEvent.click(screen.getByText('Skip'));

    expect(mockOnAnswer).toHaveBeenCalledWith('ask-1', 'User declined to answer.');
  });

  it('multiple questions: renders both questions', () => {
    const multiQuestionRequest = {
      requestId: 'ask-3',
      questions: [
        {
          question: 'Which framework?',
          header: 'Framework',
          options: [{ label: 'React', description: 'UI library' }, { label: 'Vue', description: 'Progressive framework' }],
          multiSelect: false,
        },
        {
          question: 'Which language?',
          header: 'Language',
          options: [{ label: 'TypeScript', description: 'Typed JS' }, { label: 'JavaScript', description: 'Dynamic JS' }],
          multiSelect: false,
        },
      ],
    };

    render(
      <AskUserQuestionModal request={multiQuestionRequest} onAnswer={mockOnAnswer} />
    );

    expect(screen.getByText('Which framework?')).toBeInTheDocument();
    expect(screen.getByText('Which language?')).toBeInTheDocument();
    expect(screen.getByText('Framework')).toBeInTheDocument();
    expect(screen.getByText('Language')).toBeInTheDocument();

    // Should use plural "answers" for multiple questions
    expect(screen.getByText('Please select your answers below')).toBeInTheDocument();

    // Submit with both answers
    const radios = screen.getAllByRole('radio');
    // Q1: React, Vue, Other => 3; Q2: TypeScript, JavaScript, Other => 3; total 6
    expect(radios).toHaveLength(6);

    fireEvent.click(radios[0]); // React for Q1
    fireEvent.click(radios[3]); // TypeScript for Q2

    fireEvent.click(screen.getByText('Submit'));

    expect(mockOnAnswer).toHaveBeenCalledWith(
      'ask-3',
      'Q: Which framework?\nA: React\n\nQ: Which language?\nA: TypeScript'
    );
  });

  it('resets state when request changes (different requestId)', () => {
    const { rerender } = render(
      <AskUserQuestionModal request={defaultRequest} onAnswer={mockOnAnswer} />
    );

    // Select an option
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]); // React
    expect(radios[0]).toBeChecked();
    expect(screen.getByText('Submit')).not.toBeDisabled();

    // Change request
    const newRequest = {
      requestId: 'ask-new',
      questions: [{
        question: 'Which database?',
        header: 'Database',
        options: [
          { label: 'PostgreSQL', description: 'Relational DB' },
          { label: 'MongoDB', description: 'Document DB' },
        ],
        multiSelect: false,
      }],
    };

    rerender(
      <AskUserQuestionModal request={newRequest} onAnswer={mockOnAnswer} />
    );

    // Should show new question content
    expect(screen.getByText('Which database?')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();

    // All options should be unselected
    const newRadios = screen.getAllByRole('radio');
    for (const radio of newRadios) {
      expect(radio).not.toBeChecked();
    }

    // Submit should be disabled again
    expect(screen.getByText('Submit')).toBeDisabled();
  });
});
