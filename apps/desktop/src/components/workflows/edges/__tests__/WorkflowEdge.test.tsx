import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WorkflowEdge } from '../WorkflowEdge';

vi.mock('@xyflow/react', () => ({
  BaseEdge: (props: any) => <path data-testid="base-edge" data-id={props.id} data-path={props.path} />,
  EdgeLabelRenderer: (props: any) => <div data-testid="edge-label-renderer">{props.children}</div>,
  getBezierPath: () => ['M0,0 C10,10 20,20 30,30', 50, 50],
}));

const baseProps = {
  id: 'e1',
  source: 'n1',
  target: 'n2',
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: 'bottom' as any,
  targetPosition: 'top' as any,
  sourceHandleId: null,
  targetHandleId: null,
  animated: false,
  selected: false,
  data: {},
  markerEnd: undefined,
  markerStart: undefined,
  interactionWidth: 20,
  type: 'default',
  label: undefined,
  labelStyle: undefined,
  labelShowBg: undefined,
  labelBgStyle: undefined,
  labelBgPadding: undefined,
  labelBgBorderRadius: undefined,
  style: undefined,
  deletable: true,
  selectable: true,
  focusable: true,
  hidden: false,
  pathOptions: undefined,
  zIndex: 0,
  reconnectable: false,
};

describe('WorkflowEdge', () => {
  it('renders BaseEdge', () => {
    const { container } = render(
      <svg>
        <WorkflowEdge {...baseProps as any} />
      </svg>,
    );
    expect(container.querySelector('[data-testid="base-edge"]')).toBeTruthy();
  });

  it('does not render label for success edge type', () => {
    const { container } = render(
      <svg>
        <WorkflowEdge {...baseProps as any} data={{ edgeType: 'success' }} />
      </svg>,
    );
    expect(container.querySelector('[data-testid="edge-label-renderer"]')).toBeNull();
  });

  it('renders Error label for error edge type', () => {
    const { container } = render(
      <svg>
        <WorkflowEdge {...baseProps as any} data={{ edgeType: 'error' }} />
      </svg>,
    );
    const labelRenderer = container.querySelector('[data-testid="edge-label-renderer"]');
    expect(labelRenderer).toBeTruthy();
    expect(labelRenderer!.textContent).toContain('Error');
  });

  it('renders True label for condition_true edge type', () => {
    const { container } = render(
      <svg>
        <WorkflowEdge {...baseProps as any} data={{ edgeType: 'condition_true' }} />
      </svg>,
    );
    const labelRenderer = container.querySelector('[data-testid="edge-label-renderer"]');
    expect(labelRenderer).toBeTruthy();
    expect(labelRenderer!.textContent).toContain('True');
  });

  it('renders False label for condition_false edge type', () => {
    const { container } = render(
      <svg>
        <WorkflowEdge {...baseProps as any} data={{ edgeType: 'condition_false' }} />
      </svg>,
    );
    const labelRenderer = container.querySelector('[data-testid="edge-label-renderer"]');
    expect(labelRenderer).toBeTruthy();
    expect(labelRenderer!.textContent).toContain('False');
  });

  it('defaults to success edge type when no data', () => {
    const { container } = render(
      <svg>
        <WorkflowEdge {...baseProps as any} data={{}} />
      </svg>,
    );
    // success has no label, so no label renderer
    expect(container.querySelector('[data-testid="edge-label-renderer"]')).toBeNull();
  });
});
