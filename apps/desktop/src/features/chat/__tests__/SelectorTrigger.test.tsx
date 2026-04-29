import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectorTrigger } from '../SelectorTrigger';

describe('SelectorTrigger', () => {
  it('renders children', () => {
    render(
      <SelectorTrigger onClick={() => {}}>
        <span>Test Content</span>
      </SelectorTrigger>
    );

    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(
      <SelectorTrigger onClick={handleClick}>
        Click me
      </SelectorTrigger>
    );

    fireEvent.click(screen.getByRole('button'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(
      <SelectorTrigger onClick={handleClick} disabled>
        Disabled
      </SelectorTrigger>
    );

    fireEvent.click(screen.getByRole('button'));

    expect(handleClick).not.toHaveBeenCalled();
  });

  it('does not call onClick when locked', () => {
    const handleClick = vi.fn();
    render(
      <SelectorTrigger onClick={handleClick} locked>
        Locked
      </SelectorTrigger>
    );

    fireEvent.click(screen.getByRole('button'));

    expect(handleClick).not.toHaveBeenCalled();
  });

  it('shows disabled state with opacity class', () => {
    render(
      <SelectorTrigger onClick={() => {}} disabled>
        Disabled
      </SelectorTrigger>
    );

    const button = screen.getByRole('button');
    expect(button.className).toContain('opacity-50');
    expect(button.className).toContain('cursor-not-allowed');
  });

  it('shows locked state with amber styling', () => {
    render(
      <SelectorTrigger onClick={() => {}} locked>
        Locked
      </SelectorTrigger>
    );

    const button = screen.getByRole('button');
    expect(button.className).toContain('cursor-not-allowed');
    expect(button.className).toContain('text-amber');
  });

  it('uses lock reason as title when locked', () => {
    render(
      <SelectorTrigger onClick={() => {}} locked lockReason="Task in progress">
        Locked
      </SelectorTrigger>
    );

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Task in progress');
  });

  it('uses custom title when not locked', () => {
    render(
      <SelectorTrigger onClick={() => {}} title="Custom title">
        Test
      </SelectorTrigger>
    );

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Custom title');
  });

  it('applies custom className', () => {
    render(
      <SelectorTrigger onClick={() => {}} className="custom-class">
        Test
      </SelectorTrigger>
    );

    const button = screen.getByRole('button');
    expect(button.className).toContain('custom-class');
  });

  it('sets aria-label', () => {
    render(
      <SelectorTrigger onClick={() => {}} ariaLabel="Select option">
        Test
      </SelectorTrigger>
    );

    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Select option');
  });

  it('has hover class when not disabled or locked', () => {
    render(
      <SelectorTrigger onClick={() => {}}>
        Test
      </SelectorTrigger>
    );

    const button = screen.getByRole('button');
    expect(button.className).toContain('hover:bg-muted');
  });

  it('prefers lock reason over title when both provided and locked', () => {
    render(
      <SelectorTrigger
        onClick={() => {}}
        locked
        lockReason="Lock reason"
        title="Title"
      >
        Test
      </SelectorTrigger>
    );

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Lock reason');
  });

  it('uses title when locked but no lock reason provided', () => {
    render(
      <SelectorTrigger
        onClick={() => {}}
        locked
        title="Title"
      >
        Test
      </SelectorTrigger>
    );

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Title');
  });

  it('uses "Locked" as default title when locked with no title or lock reason', () => {
    render(
      <SelectorTrigger onClick={() => {}} locked>
        Test
      </SelectorTrigger>
    );

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Locked');
  });
});
