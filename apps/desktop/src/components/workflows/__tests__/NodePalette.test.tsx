import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NodePalette } from '../NodePalette';
import { useWorkflowStore } from '../../../stores/workflowStore';

vi.mock('../../../stores/workflowStore', () => ({
  useWorkflowStore: vi.fn(() => ({ stepTypes: [] })),
}));

vi.mock('../nodes/StepNode', () => ({
  getStepIcon: (type: string) => <span data-testid={`icon-${type}`}>icon</span>,
}));

describe('NodePalette', () => {
  beforeEach(() => {
    (useWorkflowStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ stepTypes: [] });
  });

  it('renders built-in category labels', () => {
    const { container } = render(<NodePalette />);
    expect(container.textContent).toContain('Git');
    expect(container.textContent).toContain('AI');
    expect(container.textContent).toContain('Automation');
    expect(container.textContent).toContain('Flow Control');
  });

  it('renders built-in step items', () => {
    const { container } = render(<NodePalette />);
    expect(container.textContent).toContain('Git Commit');
    expect(container.textContent).toContain('Git Merge');
    expect(container.textContent).toContain('AI Review');
    expect(container.textContent).toContain('Shell Command');
    expect(container.textContent).toContain('Condition');
    expect(container.textContent).toContain('Wait / Approval');
  });

  it('renders header text', () => {
    const { container } = render(<NodePalette />);
    expect(container.textContent).toContain('Drag to add');
  });

  it('step items are draggable', () => {
    const { container } = render(<NodePalette />);
    const draggableItems = container.querySelectorAll('[draggable="true"]');
    expect(draggableItems.length).toBeGreaterThan(0);
  });

  it('sets drag data on drag start', () => {
    const { container } = render(<NodePalette />);
    const firstDraggable = container.querySelector('[draggable="true"]')!;
    const setData = vi.fn();
    fireEvent.dragStart(firstDraggable, {
      dataTransfer: { setData, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith('application/workflow-node-type', expect.any(String));
    expect(setData).toHaveBeenCalledWith('application/workflow-node-label', expect.any(String));
  });

  it('renders plugin step types in appropriate category', () => {
    (useWorkflowStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      stepTypes: [
        { type: 'my_plugin_step', name: 'My Plugin Step', source: 'plugin', category: 'Plugins' },
      ],
    });
    const { container } = render(<NodePalette />);
    expect(container.textContent).toContain('Plugins');
    expect(container.textContent).toContain('My Plugin Step');
  });

  it('adds plugin step to existing category when matching', () => {
    (useWorkflowStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      stepTypes: [
        { type: 'custom_git', name: 'Custom Git Op', source: 'plugin', category: 'Git' },
      ],
    });
    const { container } = render(<NodePalette />);
    expect(container.textContent).toContain('Custom Git Op');
  });
});
