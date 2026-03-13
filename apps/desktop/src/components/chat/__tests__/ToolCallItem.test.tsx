import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToolCallItem, ToolCallList } from '../ToolCallItem';
import type { ToolCallState } from '../../../stores/chatStore';

// Mock heavy sub-components
vi.mock('../DiffViewer', () => ({
  DiffViewer: ({ oldString, newString, filePath }: any) => (
    <div data-testid="diff-viewer">
      <span>{oldString}</span>
      <span>{newString}</span>
      {filePath && <span>{filePath}</span>}
    </div>
  ),
}));

vi.mock('../CodeViewer', () => ({
  CodeViewer: ({ content, filePath }: any) => (
    <div data-testid="code-viewer">
      <span>{content}</span>
      {filePath && <span>{filePath}</span>}
    </div>
  ),
}));

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ sendMessage: vi.fn() }),
}));

vi.mock('../../../stores/terminalStore', () => ({
  useTerminalStore: Object.assign(
    (selector: any) => selector({ terminals: {} }),
    { getState: () => ({ terminals: {}, waitForReady: vi.fn() }) },
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

vi.mock('../../../services/toolRendererRegistry', () => ({
  toolRendererRegistry: { get: () => null },
}));

const createToolCall = (overrides: Partial<ToolCallState> = {}): ToolCallState => ({
  id: 'tool-1',
  toolName: 'Read',
  toolInput: { file_path: '/project/file.ts' },
  status: 'completed',
  result: 'File content here',
  isError: false,
  ...overrides,
});

describe('ToolCallItem', () => {
  // ── Basic display ─────────────────────────────────────────────────────────

  describe('display', () => {
    it('renders tool name', () => {
      render(<ToolCallItem toolCall={createToolCall({ toolName: 'Read' })} />);
      expect(screen.getByTestId('tool-name').textContent).toBe('Read');
    });

    it('renders tool-use test id', () => {
      render(<ToolCallItem toolCall={createToolCall()} />);
      expect(screen.getByTestId('tool-use')).toBeInTheDocument();
    });

    it('shows running spinner when status is running', () => {
      const { container } = render(<ToolCallItem toolCall={createToolCall({ status: 'running' })} />);
      const spinner = container.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('shows success checkmark when completed without error', () => {
      const { container } = render(<ToolCallItem toolCall={createToolCall({ status: 'completed', isError: false })} />);
      const checkIcon = container.querySelector('.text-success');
      expect(checkIcon).toBeInTheDocument();
    });

    it('shows error icon when completed with error', () => {
      const { container } = render(<ToolCallItem toolCall={createToolCall({ status: 'completed', isError: true })} />);
      const errorIcon = container.querySelector('.text-destructive');
      expect(errorIcon).toBeInTheDocument();
    });

    it('uses primary border for running status', () => {
      render(<ToolCallItem toolCall={createToolCall({ status: 'running' })} />);
      const el = screen.getByTestId('tool-use');
      expect(el.className).toContain('border-primary/30');
    });

    it('uses destructive border for error status', () => {
      render(<ToolCallItem toolCall={createToolCall({ status: 'completed', isError: true })} />);
      const el = screen.getByTestId('tool-use');
      expect(el.className).toContain('border-destructive/30');
    });

    it('uses success border for completed status without error', () => {
      render(<ToolCallItem toolCall={createToolCall({ status: 'completed', isError: false })} />);
      const el = screen.getByTestId('tool-use');
      expect(el.className).toContain('border-success/30');
    });

    it('AskUserQuestion with isError shows as success (not error)', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'AskUserQuestion',
        toolInput: { questions: [{ question: 'What?' }] },
        isError: true,
      })} />);
      const el = screen.getByTestId('tool-use');
      // AskUserQuestion treats isError as expected behavior, not destructive
      expect(el.className).toContain('border-success/30');
    });
  });

  // ── Expand/collapse ───────────────────────────────────────────────────────

  describe('expand/collapse', () => {
    it('starts collapsed', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        result: 'result text',
      })} />);
      expect(screen.queryByText('Result:')).not.toBeInTheDocument();
    });

    it('expands when clicked to show content', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'CustomTool',
        toolInput: { key: 'value' },
        status: 'completed',
        result: 'Test result',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Result:')).toBeInTheDocument();
      expect(screen.getByText('Test result')).toBeInTheDocument();
    });

    it('collapses when clicked again', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        result: 'Test result',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Result:')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button'));
      expect(screen.queryByText('Result:')).not.toBeInTheDocument();
    });

    it('shows Input label for generic tools when expanded', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'CustomTool',
        toolInput: { file_path: '/test.ts', encoding: 'utf-8' },
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Input:')).toBeInTheDocument();
      expect(screen.getAllByText(/"file_path":/).length).toBeGreaterThanOrEqual(1);
    });

    it('shows Error label when isError is true', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        isError: true,
        result: 'Command failed',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Error:')).toBeInTheDocument();
    });

    it('does not show result when still running', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'CustomTool',
        status: 'running',
        result: undefined,
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.queryByText('Result:')).not.toBeInTheDocument();
    });
  });

  // ── formatToolInput ───────────────────────────────────────────────────────

  describe('formatToolInput summary display', () => {
    it('formats Read tool with file path', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Read',
        toolInput: { file_path: '/project/src/index.ts' },
      })} />);
      expect(screen.getByText('/project/src/index.ts')).toBeInTheDocument();
    });

    it('formats Write tool with file path', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Write',
        toolInput: { file_path: '/project/new-file.ts', content: 'hello' },
      })} />);
      expect(screen.getByText('/project/new-file.ts')).toBeInTheDocument();
    });

    it('formats Edit tool with file path', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Edit',
        toolInput: { file_path: '/project/file.ts', old_string: 'old', new_string: 'new' },
      })} />);
      expect(screen.getByText('/project/file.ts')).toBeInTheDocument();
    });

    it('formats Bash tool with command', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
      })} />);
      expect(screen.getByText('npm test')).toBeInTheDocument();
    });

    it('formats Grep tool with pattern and path', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Grep',
        toolInput: { pattern: 'TODO', path: '/project/src' },
      })} />);
      expect(screen.getByText(/TODO.*in \/project\/src/)).toBeInTheDocument();
    });

    it('formats Glob tool with pattern', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Glob',
        toolInput: { pattern: '**/*.ts' },
      })} />);
      expect(screen.getByText(/\*\*\/\*\.ts/)).toBeInTheDocument();
    });

    it('formats WebFetch with URL', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'WebFetch',
        toolInput: { url: 'https://example.com/api' },
      })} />);
      expect(screen.getByText('https://example.com/api')).toBeInTheDocument();
    });

    it('formats WebSearch with query', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'WebSearch',
        toolInput: { query: 'vitest testing guide' },
      })} />);
      expect(screen.getByText('vitest testing guide')).toBeInTheDocument();
    });

    it('formats Task tool with description', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Task',
        toolInput: { description: 'Search for files' },
      })} />);
      expect(screen.getByText('Search for files')).toBeInTheDocument();
    });

    it('formats AskUserQuestion with question count', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'AskUserQuestion',
        toolInput: { questions: [{ question: 'What?' }] },
      })} />);
      expect(screen.getByText('1 question')).toBeInTheDocument();
    });

    it('formats AskUserQuestion plural', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'AskUserQuestion',
        toolInput: { questions: [{ question: 'A?' }, { question: 'B?' }] },
      })} />);
      expect(screen.getByText('2 questions')).toBeInTheDocument();
    });

    it('formats TodoWrite tool', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'TodoWrite',
        toolInput: { todos: [{ content: 'Task 1', status: 'pending' }] },
      })} />);
      expect(screen.getByText('Update task list')).toBeInTheDocument();
    });

    it('formats EnterPlanMode tool', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'EnterPlanMode',
        toolInput: {},
      })} />);
      expect(screen.getByText('Entering plan mode')).toBeInTheDocument();
    });

    it('falls back to JSON stringify for unknown tools', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'UnknownTool',
        toolInput: { foo: 'bar' },
      })} />);
      expect(screen.getByText(/"foo"/)).toBeInTheDocument();
    });

    it('handles null input', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Read',
        toolInput: null,
      })} />);
      expect(screen.getByTestId('tool-name').textContent).toBe('Read');
    });

    it('handles stringified JSON input (normalizeToolInput)', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Bash',
        toolInput: '{"command":"ls -la"}',
      })} />);
      expect(screen.getByText('ls -la')).toBeInTheDocument();
    });
  });

  // ── Tool-specific expanded content ────────────────────────────────────────

  describe('tool-specific expanded content', () => {
    it('shows DiffViewer for Edit tool when expanded', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Edit',
        toolInput: { file_path: '/file.ts', old_string: 'const x = 1;', new_string: 'const x = 2;' },
        status: 'completed',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByTestId('diff-viewer')).toBeInTheDocument();
    });

    it('shows Edit error result alongside diff', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Edit',
        toolInput: { file_path: '/file.ts', old_string: 'old', new_string: 'new' },
        status: 'completed',
        isError: true,
        result: 'old_string not found',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByTestId('diff-viewer')).toBeInTheDocument();
      expect(screen.getByTestId('tool-result').textContent).toContain('old_string not found');
    });

    it('shows CodeViewer for Write tool when expanded', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Write',
        toolInput: { file_path: '/file.ts', content: 'console.log("hello")' },
        status: 'completed',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByTestId('code-viewer')).toBeInTheDocument();
    });

    it('shows CodeViewer for Read tool result when expanded', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Read',
        toolInput: { file_path: '/file.ts' },
        status: 'completed',
        result: 'const x = 1;',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByTestId('code-viewer')).toBeInTheDocument();
    });

    it('shows terminal-style command for Bash tool', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        status: 'completed',
        result: 'PASS all tests',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      // Command shown with $ prefix
      const container = screen.getByTestId('tool-use');
      expect(container.textContent).toContain('$ ');
      expect(container.textContent).toContain('npm test');
      expect(screen.getByTestId('tool-result').textContent).toContain('PASS all tests');
    });

    it('shows Bash error result with error styling', () => {
      const { container } = render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Bash',
        toolInput: { command: 'bad-cmd' },
        status: 'completed',
        isError: true,
        result: 'command not found',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      const resultEl = screen.getByTestId('tool-result');
      expect(resultEl.className).toContain('bg-red-950');
    });

    it('shows terminal output expand/collapse for long Bash results', () => {
      const longResult = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Bash',
        toolInput: { command: 'cat file' },
        status: 'completed',
        result: longResult,
      })} />);
      fireEvent.click(screen.getByRole('button'));
      // Should show "Show all X lines" button
      expect(screen.getByText(/Show all 20 lines/)).toBeInTheDocument();
    });

    it('expands terminal output when clicking "Show all" button', () => {
      const longResult = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Bash',
        toolInput: { command: 'cat file' },
        status: 'completed',
        result: longResult,
      })} />);
      fireEvent.click(screen.getByRole('button')); // Expand tool call
      fireEvent.click(screen.getByText(/Show all 20 lines/)); // Expand terminal output
      expect(screen.getByText('Collapse')).toBeInTheDocument();
    });

    it('shows AskUserQuestion with formatted questions when expanded', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'AskUserQuestion',
        toolInput: {
          questions: [{
            question: 'Which framework?',
            header: 'Framework',
            options: [
              { label: 'React', description: 'A JS library' },
              { label: 'Vue', description: 'Progressive framework' },
            ],
          }],
        },
        status: 'completed',
        result: 'React',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Framework')).toBeInTheDocument();
      expect(screen.getByText('Which framework?')).toBeInTheDocument();
      expect(screen.getAllByText('React').length).toBeGreaterThan(0);
      expect(screen.getByText('Vue')).toBeInTheDocument();
    });

    it('shows user answer for AskUserQuestion', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'AskUserQuestion',
        toolInput: { questions: [{ question: 'Pick', header: 'Q', options: [] }] },
        status: 'completed',
        isError: true,
        result: 'User chose option A',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText("User's Answer:")).toBeInTheDocument();
      expect(screen.getByText('User chose option A')).toBeInTheDocument();
    });

    it('shows TodoWrite with task list when expanded', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'TodoWrite',
        toolInput: {
          todos: [
            { content: 'Fix bug', status: 'completed' },
            { content: 'Write tests', status: 'in_progress' },
            { content: 'Deploy', status: 'pending' },
          ],
        },
        status: 'completed',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Fix bug')).toBeInTheDocument();
      expect(screen.getByText('Write tests')).toBeInTheDocument();
      expect(screen.getByText('Deploy')).toBeInTheDocument();
    });

    it('shows completed todo with strikethrough', () => {
      const { container } = render(<ToolCallItem toolCall={createToolCall({
        toolName: 'TodoWrite',
        toolInput: { todos: [{ content: 'Done task', status: 'completed' }] },
        status: 'completed',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      const doneEl = screen.getByText('Done task');
      expect(doneEl.className).toContain('line-through');
    });

    it('shows Agent activity indicator when running', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Agent',
        toolInput: { description: 'Research' },
        status: 'running',
        activity: 'Reading file...',
      })} />);
      expect(screen.getByText('Reading file...')).toBeInTheDocument();
    });

    it('does not show Agent activity when not running', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Agent',
        toolInput: { description: 'Research' },
        status: 'completed',
        activity: 'Reading file...',
      })} />);
      expect(screen.queryByText('Reading file...')).not.toBeInTheDocument();
    });

    it('does not show activity for non-Agent tools', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        status: 'running',
        activity: 'Some activity',
      })} />);
      expect(screen.queryByText('Some activity')).not.toBeInTheDocument();
    });
  });

  // ── ExitPlanMode ──────────────────────────────────────────────────────────

  describe('ExitPlanMode', () => {
    it('displays plan content when plan is a string', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: { plan: '# My Plan\n\nStep 1: Do something' },
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getAllByText(/My Plan/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Step 1/)).toBeInTheDocument();
    });

    it('displays plan when plan is an object', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: { plan: { steps: ['a', 'b'] } },
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getAllByText(/"steps"/).length).toBeGreaterThanOrEqual(1);
    });

    it('displays plan_file message when plan_file exists', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: { plan_file: '/path/to/plan.md' },
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getAllByText(/Plan file:/).length).toBeGreaterThanOrEqual(1);
    });

    it('displays fallback message when no plan data', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: {},
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getAllByText(/Plan ready for review/).length).toBeGreaterThanOrEqual(1);
    });

    it('shows result after plan content', () => {
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: { plan: '# Plan' },
        status: 'completed',
        result: 'Plan approved',
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByTestId('tool-result').textContent).toContain('Plan approved');
    });

    it('shows plan expand/collapse for long plans', () => {
      const longPlan = Array.from({ length: 30 }, (_, i) => `Step ${i}: Do thing ${i}`).join('\n');
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'ExitPlanMode',
        toolInput: { plan: longPlan },
      })} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText(/Show full plan/)).toBeInTheDocument();
    });
  });

  // ── formatToolResult ──────────────────────────────────────────────────────

  describe('formatToolResult (no truncation)', () => {
    it('shows full long string results', () => {
      const longResult = 'A'.repeat(600);
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        result: longResult,
      })} />);
      fireEvent.click(screen.getByRole('button'));
      const resultEl = screen.getByTestId('tool-result');
      expect(resultEl.textContent).toContain('A'.repeat(600));
    });

    it('shows full long JSON results', () => {
      const longResult = { data: 'A'.repeat(600) };
      render(<ToolCallItem toolCall={createToolCall({
        toolName: 'CustomTool',
        status: 'completed',
        result: longResult,
      })} />);
      fireEvent.click(screen.getByRole('button'));
      const resultEl = screen.getByTestId('tool-result');
      expect(resultEl.textContent).toContain('A'.repeat(600));
    });
  });

  // ── Pending status ────────────────────────────────────────────────────────

  it('renders tool with pending status', () => {
    render(<ToolCallItem toolCall={createToolCall({ status: 'pending' as any })} />);
    expect(screen.getByTestId('tool-name').textContent).toBe('Read');
  });
});

// ── ToolCallList ──────────────────────────────────────────────────────────────

describe('ToolCallList', () => {
  const makeTc = (id: string, overrides: Partial<ToolCallState> = {}): ToolCallState => ({
    id,
    toolName: 'Read',
    toolInput: { file_path: '/test.ts' },
    status: 'completed',
    result: 'content',
    isError: false,
    ...overrides,
  });

  it('renders nothing when empty', () => {
    const { container } = render(<ToolCallList toolCalls={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all tool calls when not collapsed', () => {
    const toolCalls = [makeTc('tc-1'), makeTc('tc-2'), makeTc('tc-3')];
    render(<ToolCallList toolCalls={toolCalls} />);
    expect(screen.getAllByTestId('tool-use')).toHaveLength(3);
  });

  it('re-renders with different tool calls', () => {
    const toolCalls = [makeTc('tc-1')];
    const { rerender } = render(<ToolCallList toolCalls={toolCalls} />);
    rerender(<ToolCallList toolCalls={[makeTc('tc-2')]} />);
    expect(screen.getAllByTestId('tool-use')).toHaveLength(1);
  });

  // ── defaultCollapsed ──────────────────────────────────────────────────────

  describe('defaultCollapsed', () => {
    it('shows collapsed summary when defaultCollapsed is true', () => {
      const toolCalls = [makeTc('tc-1'), makeTc('tc-2')];
      render(<ToolCallList toolCalls={toolCalls} defaultCollapsed />);
      expect(screen.getByText('2 tool calls')).toBeInTheDocument();
      expect(screen.getByText('Click to expand')).toBeInTheDocument();
    });

    it('shows tool call count badges in collapsed view', () => {
      const toolCalls = [
        makeTc('tc-1', { status: 'completed' }),
        makeTc('tc-2', { status: 'error', isError: true }),
        makeTc('tc-3', { status: 'running' }),
      ];
      render(<ToolCallList toolCalls={toolCalls} defaultCollapsed />);
      expect(screen.getByText('3 tool calls')).toBeInTheDocument();
    });

    it('expands when collapsed summary is clicked', () => {
      const toolCalls = [makeTc('tc-1')];
      render(<ToolCallList toolCalls={toolCalls} defaultCollapsed />);
      expect(screen.getByText('1 tool call')).toBeInTheDocument();
      fireEvent.click(screen.getByText('1 tool call').closest('div')!);
      expect(screen.getAllByTestId('tool-use')).toHaveLength(1);
    });

    it('shows collapse button after expanding', () => {
      const toolCalls = [makeTc('tc-1')];
      render(<ToolCallList toolCalls={toolCalls} defaultCollapsed />);
      fireEvent.click(screen.getByText('1 tool call').closest('div')!);
      expect(screen.getByText('Collapse tool calls')).toBeInTheDocument();
    });

    it('re-collapses when collapse button is clicked', () => {
      const toolCalls = [makeTc('tc-1')];
      render(<ToolCallList toolCalls={toolCalls} defaultCollapsed />);
      // Expand
      fireEvent.click(screen.getByText('1 tool call').closest('div')!);
      expect(screen.getAllByTestId('tool-use')).toHaveLength(1);
      // Collapse
      fireEvent.click(screen.getByText('Collapse tool calls'));
      expect(screen.getByText('1 tool call')).toBeInTheDocument();
    });
  });

  // ── Many tool calls (MAX_VISIBLE_TOOLS) ─────────────────────────────────

  describe('many tool calls', () => {
    it('shows "Show N earlier" button when more than 5 tool calls', () => {
      const toolCalls = Array.from({ length: 8 }, (_, i) => makeTc(`tc-${i}`));
      render(<ToolCallList toolCalls={toolCalls} />);
      // Only last 5 visible, 3 hidden
      expect(screen.getByText(/Show 3 earlier tool calls/)).toBeInTheDocument();
    });

    it('shows all tool calls when "Show earlier" button is clicked', () => {
      const toolCalls = Array.from({ length: 8 }, (_, i) => makeTc(`tc-${i}`));
      render(<ToolCallList toolCalls={toolCalls} />);
      fireEvent.click(screen.getByText(/Show 3 earlier tool calls/));
      expect(screen.getAllByTestId('tool-use')).toHaveLength(8);
    });

    it('does not show "Show earlier" for 5 or fewer tool calls', () => {
      const toolCalls = Array.from({ length: 5 }, (_, i) => makeTc(`tc-${i}`));
      render(<ToolCallList toolCalls={toolCalls} />);
      expect(screen.queryByText(/Show.*earlier/)).not.toBeInTheDocument();
      expect(screen.getAllByTestId('tool-use')).toHaveLength(5);
    });
  });

  // ── Collapsed summary details ─────────────────────────────────────────────

  describe('collapsed summary badges', () => {
    it('shows individual tool summaries in collapsed view', () => {
      const toolCalls = [
        makeTc('tc-1', { toolName: 'Read', toolInput: { file_path: '/src/index.ts' } }),
        makeTc('tc-2', { toolName: 'Bash', toolInput: { command: 'npm test' } }),
      ];
      render(<ToolCallList toolCalls={toolCalls} defaultCollapsed />);
      // The collapsed view shows short summaries
      expect(screen.getByText('index.ts')).toBeInTheDocument();
      expect(screen.getByText('npm')).toBeInTheDocument();
    });
  });
});
