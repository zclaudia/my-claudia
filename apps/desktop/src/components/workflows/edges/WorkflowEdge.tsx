import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { WorkflowEdgeType } from '@my-claudia/shared';

const EDGE_STYLES: Record<WorkflowEdgeType, {
  stroke: string;
  strokeDasharray?: string;
  label: string;
  labelColor: string;
}> = {
  success: { stroke: 'hsl(var(--muted-foreground) / 0.4)', label: '', labelColor: '' },
  error: { stroke: '#ef4444', strokeDasharray: '5,5', label: 'Error', labelColor: '#ef4444' },
  condition_true: { stroke: '#22c55e', label: 'True', labelColor: '#22c55e' },
  condition_false: { stroke: '#ef4444', label: 'False', labelColor: '#ef4444' },
};

export const WorkflowEdge = memo(function WorkflowEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  } = props;

  const edgeType = (data?.edgeType as WorkflowEdgeType) ?? 'success';
  const style = EDGE_STYLES[edgeType] ?? EDGE_STYLES.success;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'hsl(var(--primary))' : style.stroke,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: style.strokeDasharray,
        }}
      />
      {style.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-card border border-border"
          >
            <span style={{ color: style.labelColor }}>{style.label}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
