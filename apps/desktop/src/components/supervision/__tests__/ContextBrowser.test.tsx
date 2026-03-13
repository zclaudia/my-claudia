import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ContextBrowser } from '../ContextBrowser';

vi.mock('../../../services/api', () => ({
  getSupervisionContext: vi.fn().mockResolvedValue([]),
}));

describe('ContextBrowser', () => {
  it('renders the context browser', () => {
    const { container } = render(<ContextBrowser projectId="p1" />);
    expect(container.innerHTML).toBeTruthy();
  });
});
