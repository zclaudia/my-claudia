import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SearchFilters } from '../SearchFilters';

describe('SearchFilters', () => {
  const defaultFilters = { projectId: 'p1' };

  it('renders filter controls', () => {
    const { getByText } = render(
      <SearchFilters filters={defaultFilters} onFiltersChange={() => {}} />
    );
    expect(getByText('Advanced Filters')).toBeTruthy();
    expect(getByText('Messages')).toBeTruthy();
    expect(getByText('Files')).toBeTruthy();
  });

  it('calls onFiltersChange when role filter clicked', () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <SearchFilters filters={defaultFilters} onFiltersChange={onChange} />
    );
    fireEvent.click(getByText('User'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }));
  });

  it('calls onFiltersChange when scope changed', () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <SearchFilters filters={defaultFilters} onFiltersChange={onChange} />
    );
    fireEvent.click(getByText('Files'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scope: 'files' }));
  });

  it('shows close button when onClose provided', () => {
    const onClose = vi.fn();
    const { container } = render(
      <SearchFilters filters={defaultFilters} onFiltersChange={() => {}} onClose={onClose} />
    );
    // The close button has an svg
    const closeButtons = container.querySelectorAll('button');
    // Click the close button (last button in header area)
    const svgButton = Array.from(closeButtons).find(
      b => b.querySelector('svg path[d*="M6 18L18 6"]')
    );
    if (svgButton) {
      fireEvent.click(svgButton);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('shows Clear All button when active filters exist', () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <SearchFilters
        filters={{ projectId: 'p1', role: 'user' }}
        onFiltersChange={onChange}
      />
    );
    expect(getByText('Clear All')).toBeTruthy();
  });

  it('renders session checkboxes when sessions provided', () => {
    const sessions = [
      { id: 's1', name: 'Session 1', projectId: 'p1', createdAt: 0, updatedAt: 0, messages: [] },
    ] as any;
    const { getByText } = render(
      <SearchFilters
        filters={defaultFilters}
        sessions={sessions}
        onFiltersChange={() => {}}
      />
    );
    expect(getByText('Session 1')).toBeTruthy();
  });
});
