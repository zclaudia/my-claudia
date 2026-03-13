import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StepNode, getStepIcon } from '../StepNode';

vi.mock('@xyflow/react', () => ({
  Handle: (props: any) => <div data-testid={`handle-${props.type}-${props.id ?? 'default'}`} />,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}));

const baseProps = {
  id: 'n1',
  type: 'step',
  xPos: 0,
  yPos: 0,
  zIndex: 0,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  dragging: false,
  selected: false,
  deletable: true,
  selectable: true,
  draggable: true,
  parentId: undefined,
  sourcePosition: 'bottom' as any,
  targetPosition: 'top' as any,
  width: 180,
  height: 60,
};

describe('StepNode', () => {
  it('renders label and step type', () => {
    const { container } = render(
      <StepNode
        {...baseProps as any}
        data={{ label: 'Build Step', stepType: 'shell' }}
      />,
    );
    expect(container.textContent).toContain('Build Step');
    expect(container.textContent).toContain('shell');
  });

  it('renders target and source handles for non-condition', () => {
    const { container } = render(
      <StepNode
        {...baseProps as any}
        data={{ label: 'My Node', stepType: 'shell' }}
      />,
    );
    expect(container.querySelector('[data-testid="handle-target-default"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="handle-source-success"]')).toBeTruthy();
  });

  it('renders condition handles for condition step type', () => {
    const { container } = render(
      <StepNode
        {...baseProps as any}
        data={{ label: 'Check', stepType: 'condition' }}
      />,
    );
    expect(container.querySelector('[data-testid="handle-source-condition_true"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="handle-source-condition_false"]')).toBeTruthy();
    expect(container.textContent).toContain('True');
    expect(container.textContent).toContain('False');
  });

  it('shows error route indicator when onError is route', () => {
    const { container } = render(
      <StepNode
        {...baseProps as any}
        data={{ label: 'Risky', stepType: 'shell', onError: 'route' }}
      />,
    );
    expect(container.textContent).toContain('Error route enabled');
    expect(container.querySelector('[data-testid="handle-source-error"]')).toBeTruthy();
  });

  it('does not show error handle when onError is not route', () => {
    const { container } = render(
      <StepNode
        {...baseProps as any}
        data={{ label: 'Safe', stepType: 'shell', onError: 'abort' }}
      />,
    );
    expect(container.textContent).not.toContain('Error route enabled');
    expect(container.querySelector('[data-testid="handle-source-error"]')).toBeNull();
  });

  it('applies selected styling', () => {
    const { container } = render(
      <StepNode
        {...baseProps as any}
        selected={true}
        data={{ label: 'Selected', stepType: 'shell' }}
      />,
    );
    const node = container.firstElementChild as HTMLElement;
    expect(node.className).toContain('border-primary');
  });

  it('getStepIcon returns icon for known types', () => {
    const { container } = render(<div>{getStepIcon('shell')}</div>);
    // Lucide Terminal icon renders an svg
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('getStepIcon returns puzzle icon for unknown types', () => {
    const { container } = render(<div>{getStepIcon('unknown_type')}</div>);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
