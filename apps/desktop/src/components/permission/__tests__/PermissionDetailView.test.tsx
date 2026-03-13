import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PermissionDetailView } from '../PermissionDetailView';

// Mock ThemeContext
vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
  isDarkTheme: (theme: string) => theme === 'dark',
}));

// Mock DiffViewer
vi.mock('../../chat/DiffViewer', () => ({
  DiffViewer: ({ oldString, newString, filePath }: any) => (
    <div data-testid="diff-viewer" data-old={oldString} data-new={newString} data-file={filePath}>
      Diff
    </div>
  ),
}));

// Mock CodeViewer
vi.mock('../../chat/CodeViewer', () => ({
  CodeViewer: ({ content, filePath }: any) => (
    <div data-testid="code-viewer" data-content={content} data-file={filePath}>
      Code
    </div>
  ),
}));

// Mock react-markdown
vi.mock('react-markdown', () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('remark-gfm', () => ({
  default: () => {},
}));

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Maximize2: ({ size }: any) => <span data-testid="maximize-icon" data-size={size} />,
  X: ({ size }: any) => <span data-testid="x-icon" data-size={size} />,
}));

describe('PermissionDetailView', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Edit tool', () => {
    it('renders DiffViewer for Edit tool with old/new strings', () => {
      const detail = JSON.stringify({
        file_path: 'src/index.ts',
        old_string: 'old code',
        new_string: 'new code',
      });
      render(<PermissionDetailView toolName="Edit" detail={detail} />);
      expect(screen.getByTestId('diff-viewer')).toBeInTheDocument();
      expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-old', 'old code');
      expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-new', 'new code');
    });

    it('shows file path for Edit tool', () => {
      const detail = JSON.stringify({
        file_path: 'src/index.ts',
        old_string: 'old',
        new_string: 'new',
      });
      render(<PermissionDetailView toolName="Edit" detail={detail} />);
      expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    });

    it('renders without file_path', () => {
      const detail = JSON.stringify({
        old_string: 'old',
        new_string: 'new',
      });
      render(<PermissionDetailView toolName="Edit" detail={detail} />);
      expect(screen.getByTestId('diff-viewer')).toBeInTheDocument();
    });
  });

  describe('Write tool', () => {
    it('renders CodeViewer for Write tool', () => {
      const detail = JSON.stringify({
        file_path: 'src/new-file.ts',
        content: 'const x = 1;',
      });
      render(<PermissionDetailView toolName="Write" detail={detail} />);
      expect(screen.getByTestId('code-viewer')).toBeInTheDocument();
      expect(screen.getByTestId('code-viewer')).toHaveAttribute('data-content', 'const x = 1;');
    });
  });

  describe('Bash tool', () => {
    it('renders terminal-style command for Bash tool', () => {
      const detail = JSON.stringify({
        command: 'npm install',
        description: 'Install dependencies',
      });
      render(<PermissionDetailView toolName="Bash" detail={detail} />);
      expect(screen.getByText('npm install')).toBeInTheDocument();
      expect(screen.getByText('Install dependencies')).toBeInTheDocument();
    });

    it('renders without description', () => {
      const detail = JSON.stringify({ command: 'ls -la' });
      render(<PermissionDetailView toolName="Bash" detail={detail} />);
      expect(screen.getByText('ls -la')).toBeInTheDocument();
    });
  });

  describe('Read tool', () => {
    it('renders file path for Read tool', () => {
      const detail = JSON.stringify({ file_path: '/home/user/file.txt' });
      render(<PermissionDetailView toolName="Read" detail={detail} />);
      expect(screen.getByText('/home/user/file.txt')).toBeInTheDocument();
    });

    it('shows offset and limit when present', () => {
      const detail = JSON.stringify({
        file_path: '/file.txt',
        offset: 10,
        limit: 50,
      });
      render(<PermissionDetailView toolName="Read" detail={detail} />);
      expect(screen.getByText(/offset: 10/)).toBeInTheDocument();
      expect(screen.getByText(/limit: 50/)).toBeInTheDocument();
    });

    it('shows only offset when limit is missing', () => {
      const detail = JSON.stringify({
        file_path: '/file.txt',
        offset: 10,
      });
      render(<PermissionDetailView toolName="Read" detail={detail} />);
      expect(screen.getByText(/offset: 10/)).toBeInTheDocument();
    });
  });

  describe('Grep tool', () => {
    it('renders pattern for Grep tool', () => {
      const detail = JSON.stringify({
        pattern: 'TODO',
        path: 'src/',
      });
      render(<PermissionDetailView toolName="Grep" detail={detail} />);
      expect(screen.getByText('TODO')).toBeInTheDocument();
      expect(screen.getByText('src/')).toBeInTheDocument();
    });

    it('renders Glob tool similarly', () => {
      const detail = JSON.stringify({
        pattern: '**/*.ts',
      });
      render(<PermissionDetailView toolName="Glob" detail={detail} />);
      expect(screen.getByText('**/*.ts')).toBeInTheDocument();
    });
  });

  describe('ExitPlanMode tool', () => {
    it('renders plan as markdown', () => {
      const detail = JSON.stringify({
        plan: '# My Plan\n\n- Step 1\n- Step 2',
      });
      render(<PermissionDetailView toolName="ExitPlanMode" detail={detail} />);
      expect(screen.getByTestId('markdown')).toBeInTheDocument();
    });

    it('renders allowed prompts', () => {
      const detail = JSON.stringify({
        plan: 'Plan text',
        allowedPrompts: [
          { tool: 'Bash', prompt: 'Run tests' },
          { tool: 'Edit', prompt: 'Edit files' },
        ],
      });
      render(<PermissionDetailView toolName="ExitPlanMode" detail={detail} />);
      expect(screen.getByText('Bash')).toBeInTheDocument();
      expect(screen.getByText('Run tests')).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Edit files')).toBeInTheDocument();
    });

    it('shows expand button for plan', () => {
      const detail = JSON.stringify({ plan: 'Some plan' });
      render(<PermissionDetailView toolName="ExitPlanMode" detail={detail} />);
      expect(screen.getByText('View full plan')).toBeInTheDocument();
    });

    it('opens fullscreen overlay on expand', () => {
      const detail = JSON.stringify({ plan: 'Some plan' });
      render(<PermissionDetailView toolName="ExitPlanMode" detail={detail} />);
      fireEvent.click(screen.getByText('View full plan'));
      expect(screen.getByText('Plan Details')).toBeInTheDocument();
    });
  });

  describe('default fallback', () => {
    it('renders raw JSON for unknown tool', () => {
      const detail = JSON.stringify({ custom: 'data' });
      render(<PermissionDetailView toolName="UnknownTool" detail={detail} />);
      expect(screen.getByText(detail)).toBeInTheDocument();
    });

    it('handles invalid JSON gracefully', () => {
      render(<PermissionDetailView toolName="Bash" detail="not-json" />);
      expect(screen.getByText('not-json')).toBeInTheDocument();
    });

    it('handles non-object JSON', () => {
      render(<PermissionDetailView toolName="Bash" detail='"a string"' />);
      expect(screen.getByText('"a string"')).toBeInTheDocument();
    });
  });

  describe('maxHeightClass', () => {
    it('uses default max-h-48', () => {
      const detail = JSON.stringify({ command: 'ls' });
      const { container } = render(<PermissionDetailView toolName="Bash" detail={detail} />);
      expect(container.querySelector('.max-h-48')).toBeInTheDocument();
    });

    it('uses custom maxHeightClass', () => {
      const detail = JSON.stringify({ command: 'ls' });
      const { container } = render(<PermissionDetailView toolName="Bash" detail={detail} maxHeightClass="max-h-96" />);
      expect(container.querySelector('.max-h-96')).toBeInTheDocument();
    });
  });
});
