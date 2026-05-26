import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FileTree } from '../FileTree';

const mockListDirectory = vi.fn();

vi.mock('../../../services/api', () => ({
  listDirectory: (...args: any[]) => mockListDirectory(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileTree', () => {
  it('loads and renders root directory entries', async () => {
    mockListDirectory.mockResolvedValueOnce({
      entries: [
        { name: 'src', path: 'src', type: 'directory' },
        { name: 'package.json', path: 'package.json', type: 'file', extension: '.json', size: 100 },
      ],
      currentPath: '',
      hasMore: false,
    });

    render(<FileTree projectRoot="/repo" onOpenFile={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument();
    });
    expect(screen.getByText('package.json')).toBeInTheDocument();
    expect(mockListDirectory).toHaveBeenCalledWith({
      projectRoot: '/repo',
      relativePath: '',
      backendId: undefined,
    });
  });

  it('loads children when a directory is expanded', async () => {
    mockListDirectory
      .mockResolvedValueOnce({
        entries: [{ name: 'src', path: 'src', type: 'directory' }],
        currentPath: '',
        hasMore: false,
      })
      .mockResolvedValueOnce({
        entries: [{ name: 'App.tsx', path: 'src/App.tsx', type: 'file', extension: '.tsx', size: 200 }],
        currentPath: 'src',
        hasMore: false,
      });

    render(<FileTree projectRoot="/repo" backendId="remote-1" onOpenFile={() => {}} />);

    const srcButton = await screen.findByRole('button', { name: /src/ });
    fireEvent.click(srcButton);

    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument();
    });
    expect(mockListDirectory).toHaveBeenLastCalledWith({
      projectRoot: '/repo',
      relativePath: 'src',
      backendId: 'remote-1',
    });
  });

  it('opens a file when clicked', async () => {
    const onOpenFile = vi.fn();
    mockListDirectory.mockResolvedValueOnce({
      entries: [{ name: 'README.md', path: 'README.md', type: 'file', extension: '.md', size: 42 }],
      currentPath: '',
      hasMore: false,
    });

    render(<FileTree projectRoot="/repo" onOpenFile={onOpenFile} selectedPath="README.md" />);

    fireEvent.click(await screen.findByRole('button', { name: /README\.md/ }));

    expect(onOpenFile).toHaveBeenCalledWith('README.md');
  });

  it('shows an error when directory loading fails', async () => {
    mockListDirectory.mockRejectedValueOnce(new Error('Cannot read directory'));

    render(<FileTree projectRoot="/repo" onOpenFile={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Cannot read directory')).toBeInTheDocument();
    });
  });
});
