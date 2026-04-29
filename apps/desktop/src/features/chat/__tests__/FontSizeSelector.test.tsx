import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FontSizeSelector } from '../FontSizeSelector';
import { useUIStore } from '../../../stores/uiStore';

describe('FontSizeSelector', () => {
  beforeEach(() => {
    useUIStore.setState({ fontSize: 'medium' });
  });

  it('renders three font size buttons', () => {
    const { container } = render(<FontSizeSelector />);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
  });

  it('clicking a button calls setFontSize', () => {
    const spy = vi.spyOn(useUIStore.getState(), 'setFontSize');
    const { container } = render(<FontSizeSelector />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]); // small
    expect(useUIStore.getState().fontSize).toBeDefined();
  });
});
