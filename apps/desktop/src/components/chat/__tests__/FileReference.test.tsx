import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TextWithFileRefs, MarkdownChildrenWithFileRefs } from '../FileReference';

const mockOpenFile = vi.fn();
vi.mock('../../../stores/fileViewerStore', () => ({
  useFileViewerStore: (selector: any) => selector({ openFile: mockOpenFile }),
}));

const mockSetBottomPanelTab = vi.fn();
vi.mock('../../../stores/terminalStore', () => ({
  useTerminalStore: {
    getState: () => ({ setBottomPanelTab: mockSetBottomPanelTab }),
  },
}));

const mockProjects: Record<string, any> = {
  p1: { id: 'p1', rootPath: '/project/root' },
};

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: (selector: any) => selector({ projects: mockProjects }),
}));

describe('TextWithFileRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders plain text without file references', () => {
    render(<TextWithFileRefs text="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders file reference as clickable button', () => {
    render(<TextWithFileRefs text="Check @src/index.ts for details" />);
    expect(screen.getByRole('button', { name: /@src\/index\.ts/ })).toBeInTheDocument();
  });

  it('opens file on click', () => {
    render(<TextWithFileRefs text="See @src/utils/helpers.ts here" />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockOpenFile).toHaveBeenCalledWith('/project/root', 'src/utils/helpers.ts');
    expect(mockSetBottomPanelTab).toHaveBeenCalledWith('file');
  });

  it('handles multiple file references', () => {
    render(<TextWithFileRefs text="See @src/a.ts and @src/b.ts" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('does not open file when no project has rootPath', () => {
    // Temporarily override projects
    Object.keys(mockProjects).forEach(k => delete mockProjects[k]);
    mockProjects.p2 = { id: 'p2' }; // no rootPath

    render(<TextWithFileRefs text="See @src/a.ts" />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockOpenFile).not.toHaveBeenCalled();

    // Restore
    delete mockProjects.p2;
    mockProjects.p1 = { id: 'p1', rootPath: '/project/root' };
  });

  it('uses user variant class', () => {
    render(<TextWithFileRefs text="See @src/index.ts" variant="user" />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('border');
  });

  it('renders text at start with file reference', () => {
    render(<TextWithFileRefs text="@src/main.ts is the entry" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

describe('MarkdownChildrenWithFileRefs', () => {
  afterEach(() => {
    cleanup();
  });

  it('passes through non-string children', () => {
    render(
      <MarkdownChildrenWithFileRefs>
        <span data-testid="child">hello</span>
      </MarkdownChildrenWithFileRefs>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('replaces string children containing file refs', () => {
    render(
      <MarkdownChildrenWithFileRefs>
        {'Check @src/index.ts for details'}
      </MarkdownChildrenWithFileRefs>
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('passes through strings without file refs', () => {
    render(
      <MarkdownChildrenWithFileRefs>
        {'Just plain text'}
      </MarkdownChildrenWithFileRefs>
    );
    expect(screen.getByText('Just plain text')).toBeInTheDocument();
  });
});
