import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallItem, ToolCallList } from '../ToolCallItem';
import type { ToolCallState } from '../../../stores/chatStore';

describe('ToolCallItem', () => {
  const createToolCall = (overrides: Partial<ToolCallState> = {}): ToolCallState => ({
    id: 'tool-1',
    toolName: 'Read',
    toolInput: { file_path: '/project/file.ts' },
    status: 'completed',
    result: 'File content here',
    isError: false,
    ...overrides,
  });

  describe('display', () => {
    it('renders tool name and icon', () => {
      const toolCall = createToolCall({ toolName: 'Read' });
      render(<ToolCallItem toolCall={toolCall} />);

      expect(screen.getByText('Read')).toBeInTheDocument();
    });

    it('shows running spinner when status is running', () => {
      const toolCall = createToolCall({ status: 'running' });
      const { container } = render(<ToolCallItem toolCall={toolCall} />);

      // Component uses Lucide Loader2 icon (SVG with class animate-spin)
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('shows success checkmark when completed without error', () => {
      const toolCall = createToolCall({ status: 'completed', isError: false });
      const { container } = render(<ToolCallItem toolCall={toolCall} />);

      // Component uses Lucide CheckCircle2 icon (SVG with class text-success)
      const checkIcon = container.querySelector('.lucide-circle-check-big, .lucide-check-circle-2, .text-success');
      expect(checkIcon).toBeInTheDocument();
    });

    it('shows error X when completed with error', () => {
      const toolCall = createToolCall({ status: 'completed', isError: true });
      const { container } = render(<ToolCallItem toolCall={toolCall} />);

      // Component uses Lucide XCircle icon (SVG with class text-destructive)
      const errorIcon = container.querySelector('.text-destructive');
      expect(errorIcon).toBeInTheDocument();
    });

    it('displays formatted input summary', () => {
      const toolCall = createToolCall({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      expect(screen.getByText('npm test')).toBeInTheDocument();
    });

    it('expands to show full input JSON when clicked', () => {
      const toolCall = createToolCall({
        toolName: 'CustomTool',
        toolInput: { file_path: '/project/test.ts', encoding: 'utf-8' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      // Click to expand
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('Input:')).toBeInTheDocument();
      // The JSON input appears both in the summary and expanded input section
      expect(screen.getAllByText(/"file_path":/).length).toBeGreaterThanOrEqual(1);
    });

    it('shows result when expanded and completed', () => {
      const toolCall = createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        result: 'Test result content',
      });
      render(<ToolCallItem toolCall={toolCall} />);

      // Click to expand
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('Result:')).toBeInTheDocument();
      expect(screen.getByText('Test result content')).toBeInTheDocument();
    });

    it('does not show result when still running', () => {
      const toolCall = createToolCall({
        status: 'running',
        result: undefined,
      });
      render(<ToolCallItem toolCall={toolCall} />);

      // Click to expand
      fireEvent.click(screen.getByRole('button'));

      expect(screen.queryByText('Result:')).not.toBeInTheDocument();
    });

    it('shows Error label when isError is true', () => {
      const toolCall = createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        isError: true,
        result: 'Command failed',
      });
      render(<ToolCallItem toolCall={toolCall} />);

      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText('Error:')).toBeInTheDocument();
    });
  });

  describe('ExitPlanMode', () => {
    it('should display plan content when plan is a string', () => {
      const toolCall = createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: { plan: '# My Plan\n\nStep 1: Do something' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      // Click to expand
      fireEvent.click(screen.getByRole('button'));

      // Text may appear in both summary and expanded PlanContent
      expect(screen.getAllByText(/My Plan/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Step 1/)).toBeInTheDocument();
    });

    it('should display plan when plan is an object', () => {
      const toolCall = createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: { plan: { steps: ['a', 'b'] } },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      // Click to expand
      fireEvent.click(screen.getByRole('button'));

      // Plan object is rendered as JSON content in the PlanContent component
      expect(screen.getAllByText(/"steps"/).length).toBeGreaterThanOrEqual(1);
    });

    it('should display plan_file message when plan_file exists', () => {
      const toolCall = createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: { plan_file: '/path/to/plan.md' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      // Click to expand
      fireEvent.click(screen.getByRole('button'));

      expect(screen.getAllByText(/Plan file:/).length).toBeGreaterThanOrEqual(1);
    });

    it('should display fallback message when no plan data', () => {
      const toolCall = createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: {},
      });
      render(<ToolCallItem toolCall={toolCall} />);

      // Click to expand
      fireEvent.click(screen.getByRole('button'));

      // Text may appear in both summary and expanded PlanContent
      expect(screen.getAllByText(/Plan ready for review/).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('formatToolInput', () => {
    it('formats Read tool with file path', () => {
      const toolCall = createToolCall({
        toolName: 'Read',
        toolInput: { file_path: '/project/src/index.ts' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      expect(screen.getByText('/project/src/index.ts')).toBeInTheDocument();
    });

    it('formats Bash tool with command', () => {
      const toolCall = createToolCall({
        toolName: 'Bash',
        toolInput: { command: 'git status' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      expect(screen.getByText('git status')).toBeInTheDocument();
    });

    it('formats Grep tool with pattern and path', () => {
      const toolCall = createToolCall({
        toolName: 'Grep',
        toolInput: { pattern: 'TODO', path: '/project/src' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      expect(screen.getByText(/TODO.*in \/project\/src/)).toBeInTheDocument();
    });

    it('formats Glob tool with pattern', () => {
      const toolCall = createToolCall({
        toolName: 'Glob',
        toolInput: { pattern: '**/*.ts' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      expect(screen.getByText(/\*\*\/\*\.ts/)).toBeInTheDocument();
    });

    it('formats WebFetch with URL', () => {
      const toolCall = createToolCall({
        toolName: 'WebFetch',
        toolInput: { url: 'https://example.com/api' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      expect(screen.getByText('https://example.com/api')).toBeInTheDocument();
    });

    it('falls back to JSON stringify for unknown tools', () => {
      const toolCall = createToolCall({
        toolName: 'UnknownTool',
        toolInput: { foo: 'bar' },
      });
      render(<ToolCallItem toolCall={toolCall} />);

      // Should contain the JSON
      expect(screen.getByText(/"foo"/)).toBeInTheDocument();
    });
  });

  describe('formatToolResult (no truncation)', () => {
    it('shows full long string results without truncation', () => {
      const longResult = 'A'.repeat(600);
      const toolCall = createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        result: longResult,
      });
      render(<ToolCallItem toolCall={toolCall} />);

      fireEvent.click(screen.getByRole('button'));

      // B0: truncation removed — full content is shown, UI handles collapse/expand
      const resultEl = screen.getByTestId('tool-result');
      expect(resultEl.textContent).toContain('A'.repeat(600));
    });

    it('shows full long JSON results without truncation', () => {
      const longResult = { data: 'A'.repeat(600) };
      const toolCall = createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        result: longResult,
      });
      render(<ToolCallItem toolCall={toolCall} />);

      fireEvent.click(screen.getByRole('button'));

      // B0: truncation removed — full JSON is shown
      const resultEl = screen.getByTestId('tool-result');
      expect(resultEl.textContent).toContain('A'.repeat(600));
    });
  });

  describe('getToolIcon', () => {
    it('returns correct icon for known tools', () => {
      const readToolCall = createToolCall({ toolName: 'Read' });
      render(<ToolCallItem toolCall={readToolCall} />);
      expect(screen.getByText('Read')).toBeInTheDocument();
    });

    it('returns default icon for unknown tools', () => {
      const unknownToolCall = createToolCall({ toolName: 'CustomTool' });
      render(<ToolCallItem toolCall={unknownToolCall} />);
      expect(screen.getByText('CustomTool')).toBeInTheDocument();
    });
  });
});

describe('ToolCallList', () => {
  const createToolCall = (id: string): ToolCallState => ({
    id,
    toolName: 'Read',
    toolInput: { file_path: '/test.ts' },
    status: 'completed',
    result: 'content',
    isError: false,
  });

  it('renders nothing when empty', () => {
    const { container } = render(<ToolCallList toolCalls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all tool calls', () => {
    const toolCalls = [
      createToolCall('tc-1'),
      createToolCall('tc-2'),
      createToolCall('tc-3'),
    ];
    render(<ToolCallList toolCalls={toolCalls} />);

    // Should have 3 buttons (one for each tool call)
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('uses tool call id as key', () => {
    const toolCalls = [createToolCall('unique-id-1')];
    const { rerender } = render(<ToolCallList toolCalls={toolCalls} />);

    // Re-render with different tool call
    const newToolCalls = [createToolCall('unique-id-2')];
    rerender(<ToolCallList toolCalls={newToolCalls} />);

    // Component should update without errors
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
