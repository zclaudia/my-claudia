import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SystemInfoPanel } from '../SystemInfoPanel';

describe('SystemInfoPanel', () => {
  it('returns null when no info available', () => {
    const { container } = render(<SystemInfoPanel systemInfo={{}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders model info', () => {
    const { getByText, getAllByText } = render(
      <SystemInfoPanel systemInfo={{ model: 'claude-3' }} />
    );
    expect(getByText('System Info')).toBeTruthy();
    // Model appears in header and in badge
    expect(getAllByText('claude-3').length).toBeGreaterThanOrEqual(1);
  });

  it('renders tools list', () => {
    const { getByText } = render(
      <SystemInfoPanel systemInfo={{ model: 'test', tools: ['bash', 'read', 'write'] }} />
    );
    expect(getByText('Tools')).toBeTruthy();
    expect(getByText('bash')).toBeTruthy();
  });

  it('collapses and expands on click', () => {
    const { getByText, queryByText } = render(
      <SystemInfoPanel systemInfo={{ model: 'test', cwd: '/home/user' }} />
    );
    // Initially expanded
    expect(queryByText('/home/user')).toBeTruthy();
    // Click to collapse
    fireEvent.click(getByText('System Info'));
    expect(queryByText('/home/user')).toBeNull();
    // Click to expand
    fireEvent.click(getByText('System Info'));
    expect(queryByText('/home/user')).toBeTruthy();
  });
});
