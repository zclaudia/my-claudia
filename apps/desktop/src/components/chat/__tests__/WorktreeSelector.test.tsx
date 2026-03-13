import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));

// Mock SelectorTrigger
vi.mock('../SelectorTrigger', () => ({
  SelectorTrigger: ({ children, onClick, disabled, locked, lockReason, title }: any) => (
    <button
      onClick={onClick}
      disabled={disabled || locked}
      title={locked ? (lockReason || title || 'Locked') : title}
      data-testid="selector-trigger"
    >
      {children}
    </button>
  ),
}));

// Mock API
const mockGetProjectWorktrees = vi.fn(() => Promise.resolve([]));
const mockCreateProjectWorktree = vi.fn(() =>
  Promise.resolve({ path: '/test/worktrees/feat-new', branch: 'feat-new', isMain: false })
);

vi.mock('../../../services/api', () => ({
  getProjectWorktrees: (...args: any[]) => mockGetProjectWorktrees(...args),
  createProjectWorktree: (...args: any[]) => mockCreateProjectWorktree(...args),
}));

import { WorktreeSelector } from '../WorktreeSelector';

describe('WorktreeSelector', () => {
  const defaultProps = {
    projectId: 'proj-1',
    projectRootPath: '/test/project',
    currentWorktree: '',
    onChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProjectWorktrees.mockResolvedValue([
      { path: '/test/project', branch: 'main', isMain: true },
    ]);
  });

  it('renders without crashing', () => {
    const { container } = render(<WorktreeSelector {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('renders the trigger button', () => {
    const { container } = render(<WorktreeSelector {...defaultProps} />);
    expect(container.querySelector('[data-testid="selector-trigger"]')).toBeTruthy();
  });

  it('shows "Root" label when currentWorktree matches project root', async () => {
    const { container } = render(<WorktreeSelector {...defaultProps} />);
    // Wait for worktrees to load
    await waitFor(() => {
      expect(container.textContent).toContain('Root');
    });
  });

  it('shows branch label when worktree is loaded', async () => {
    mockGetProjectWorktrees.mockResolvedValue([
      { path: '/test/project', branch: 'main', isMain: true },
    ]);
    const { container } = render(<WorktreeSelector {...defaultProps} />);
    await waitFor(() => {
      expect(container.textContent).toContain('main');
    });
  });

  it('opens dropdown on trigger click', async () => {
    const { container } = render(<WorktreeSelector {...defaultProps} />);
    await waitFor(() => expect(mockGetProjectWorktrees).toHaveBeenCalled());

    const trigger = container.querySelector('[data-testid="selector-trigger"]')!;
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(container.textContent).toContain('Root (default)');
    });
  });

  it('shows "No additional worktrees" when only main exists', async () => {
    const { container } = render(<WorktreeSelector {...defaultProps} />);
    await waitFor(() => expect(mockGetProjectWorktrees).toHaveBeenCalled());

    const trigger = container.querySelector('[data-testid="selector-trigger"]')!;
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(container.textContent).toContain('No additional worktrees');
    });
  });

  it('does not open when disabled', async () => {
    const { container } = render(
      <WorktreeSelector {...defaultProps} disabled />
    );
    await waitFor(() => expect(mockGetProjectWorktrees).toHaveBeenCalled());

    const trigger = container.querySelector('[data-testid="selector-trigger"]')!;
    fireEvent.click(trigger);

    // Dropdown should NOT appear
    expect(container.textContent).not.toContain('Root (default)');
  });

  it('does not open when locked', async () => {
    const { container } = render(
      <WorktreeSelector {...defaultProps} locked lockReason="Session is running" />
    );
    await waitFor(() => expect(mockGetProjectWorktrees).toHaveBeenCalled());

    const trigger = container.querySelector('[data-testid="selector-trigger"]')!;
    fireEvent.click(trigger);

    expect(container.textContent).not.toContain('Root (default)');
  });

  it('shows Locked label when locked', async () => {
    const { container } = render(
      <WorktreeSelector {...defaultProps} locked lockReason="Running" />
    );
    await waitFor(() => {
      expect(container.textContent).toContain('Locked');
    });
  });

  it('calls onChange when selecting root', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <WorktreeSelector {...defaultProps} onChange={onChange} />
    );
    await waitFor(() => expect(mockGetProjectWorktrees).toHaveBeenCalled());

    const trigger = container.querySelector('[data-testid="selector-trigger"]')!;
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(container.textContent).toContain('Root (default)');
    });

    // Click the Root (default) button
    const rootBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Root (default)')
    );
    expect(rootBtn).toBeTruthy();
    fireEvent.click(rootBtn!);

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('shows non-main worktrees in dropdown', async () => {
    mockGetProjectWorktrees.mockResolvedValue([
      { path: '/test/project', branch: 'main', isMain: true },
      { path: '/test/worktrees/feat-a', branch: 'feat-a', isMain: false },
    ]);

    const { container } = render(<WorktreeSelector {...defaultProps} />);
    await waitFor(() => expect(mockGetProjectWorktrees).toHaveBeenCalled());

    const trigger = container.querySelector('[data-testid="selector-trigger"]')!;
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(container.textContent).toContain('feat-a');
    });
  });

  it('shows "New worktree..." button in dropdown', async () => {
    const { container } = render(<WorktreeSelector {...defaultProps} />);
    await waitFor(() => expect(mockGetProjectWorktrees).toHaveBeenCalled());

    const trigger = container.querySelector('[data-testid="selector-trigger"]')!;
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(container.textContent).toContain('New worktree...');
    });
  });

  it('shows create form when "New worktree..." is clicked', async () => {
    const { container } = render(<WorktreeSelector {...defaultProps} />);
    await waitFor(() => expect(mockGetProjectWorktrees).toHaveBeenCalled());

    const trigger = container.querySelector('[data-testid="selector-trigger"]')!;
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(container.textContent).toContain('New worktree...');
    });

    const newBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('New worktree...')
    );
    fireEvent.click(newBtn!);

    await waitFor(() => {
      expect(container.textContent).toContain('Branch name');
      expect(container.querySelector('input[placeholder="feat/my-feature"]')).toBeTruthy();
    });
  });

  it('highlights worktree label when override is active', async () => {
    mockGetProjectWorktrees.mockResolvedValue([
      { path: '/test/project', branch: 'main', isMain: true },
      { path: '/test/worktrees/feat-x', branch: 'feat-x', isMain: false },
    ]);

    const { container } = render(
      <WorktreeSelector
        {...defaultProps}
        currentWorktree="/test/worktrees/feat-x"
      />
    );

    await waitFor(() => {
      // Should show relative path label, not "Root"
      expect(container.textContent).not.toContain('Root');
    });
  });
});
