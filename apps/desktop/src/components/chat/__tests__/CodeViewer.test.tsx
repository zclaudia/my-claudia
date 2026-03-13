import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CodeViewer } from '../CodeViewer';

// Mock ThemeContext
vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
  isDarkTheme: (theme: string) => theme === 'dark',
}));

// Mock react-syntax-highlighter
vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children, language, showLineNumbers }: any) => (
    <pre data-testid="syntax-highlighter" data-language={language} data-line-numbers={showLineNumbers}>
      {children}
    </pre>
  ),
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: {},
  oneLight: {},
}));

describe('CodeViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders code content', () => {
    render(<CodeViewer content="const x = 1;" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveTextContent('const x = 1;');
  });

  it('detects language from file path', () => {
    render(<CodeViewer content="const x = 1;" filePath="src/index.ts" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'typescript');
  });

  it('detects language for python files', () => {
    render(<CodeViewer content="x = 1" filePath="script.py" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'python');
  });

  it('detects language for Dockerfile', () => {
    render(<CodeViewer content="FROM node" filePath="Dockerfile" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'docker');
  });

  it('detects language for Makefile', () => {
    render(<CodeViewer content="all:" filePath="Makefile" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'makefile');
  });

  it('falls back to text for unknown extensions', () => {
    render(<CodeViewer content="hello" filePath="file.xyz" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'text');
  });

  it('falls back to text when no filePath', () => {
    render(<CodeViewer content="hello" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'text');
  });

  it('uses explicit language prop over filePath detection', () => {
    render(<CodeViewer content="x = 1" filePath="file.txt" language="python" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'python');
  });

  it('displays file name from path', () => {
    render(<CodeViewer content="code" filePath="src/utils/helpers.ts" />);
    expect(screen.getByText('helpers.ts')).toBeInTheDocument();
  });

  it('displays line count', () => {
    const content = 'line1\nline2\nline3';
    render(<CodeViewer content={content} />);
    expect(screen.getByText('3 lines')).toBeInTheDocument();
  });

  it('displays singular line for 1 line', () => {
    render(<CodeViewer content="single line" />);
    expect(screen.getByText('1 line')).toBeInTheDocument();
  });

  it('collapses long content by default', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    render(<CodeViewer content={lines.join('\n')} maxLines={5} />);
    expect(screen.getByText('Show all 30 lines')).toBeInTheDocument();
  });

  it('expands collapsed content on button click', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    render(<CodeViewer content={lines.join('\n')} maxLines={5} />);

    fireEvent.click(screen.getByText('Show all 30 lines'));
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });

  it('does not show expand button when content fits', () => {
    render(<CodeViewer content="short content" maxLines={5} />);
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument();
  });

  it('copies content to clipboard', async () => {
    render(<CodeViewer content="copy me" />);
    fireEvent.click(screen.getByText('Copy'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('copy me');
  });

  it('shows line numbers by default', () => {
    render(<CodeViewer content="code" />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-line-numbers', 'true');
  });

  it('hides line numbers when showLineNumbers is false', () => {
    render(<CodeViewer content="code" showLineNumbers={false} />);
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-line-numbers', 'false');
  });

  it('detects various file extensions', () => {
    const extensions: Record<string, string> = {
      'file.js': 'javascript',
      'file.jsx': 'jsx',
      'file.tsx': 'tsx',
      'file.json': 'json',
      'file.rs': 'rust',
      'file.go': 'go',
      'file.rb': 'ruby',
      'file.java': 'java',
      'file.css': 'css',
      'file.html': 'html',
      'file.sql': 'sql',
      'file.swift': 'swift',
      'file.c': 'c',
      'file.cpp': 'cpp',
    };

    for (const [path, lang] of Object.entries(extensions)) {
      cleanup();
      render(<CodeViewer content="code" filePath={path} />);
      expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', lang);
    }
  });
});
