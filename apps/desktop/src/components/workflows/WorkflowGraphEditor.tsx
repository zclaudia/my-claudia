import { useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StepNode } from './nodes/StepNode';
import { WorkflowEdge } from './edges/WorkflowEdge';
import type {
  WorkflowNodeDef,
  WorkflowEdgeDef,
  WorkflowEdgeType,
} from '@my-claudia/shared';

// ── Type converters ───────────────────────────────────────

function toFlowNodes(nodeDefs: WorkflowNodeDef[]): Node[] {
  return nodeDefs.map(n => ({
    id: n.id,
    type: 'stepNode',
    position: n.position,
    data: {
      label: n.name,
      stepType: n.type,
      onError: n.onError,
    },
    selected: false,
  }));
}

function toFlowEdges(edgeDefs: WorkflowEdgeDef[]): Edge[] {
  return edgeDefs.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.type,
    type: 'workflowEdge',
    data: { edgeType: e.type, maxIterations: e.maxIterations },
  }));
}

export function fromFlowNodes(nodes: Node[]): WorkflowNodeDef[] {
  return nodes.map(n => ({
    id: n.id,
    name: n.data.label as string,
    type: n.data.stepType as string,
    config: (n.data.config as Record<string, unknown>) ?? {},
    position: n.position,
    onError: n.data.onError as any,
    retryCount: n.data.retryCount as number | undefined,
    timeoutMs: n.data.timeoutMs as number | undefined,
    condition: n.data.condition as any,
  }));
}

export function fromFlowEdges(edges: Edge[]): WorkflowEdgeDef[] {
  return edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: (e.data?.edgeType ?? e.sourceHandle ?? 'success') as WorkflowEdgeType,
    maxIterations: typeof e.data?.maxIterations === 'number' ? e.data.maxIterations : undefined,
  }));
}

// ── Props ─────────────────────────────────────────────────

interface WorkflowGraphEditorProps {
  initialNodes: WorkflowNodeDef[];
  initialEdges: WorkflowEdgeDef[];
  onNodesChange: (nodes: Node[]) => void;
  onEdgesChange: (edges: Edge[]) => void;
  onNodeSelect: (nodeId: string | null) => void;
  onEdgeSelect: (edgeId: string | null) => void;
}

// ── Inner component (needs ReactFlow context) ─────────────

function GraphEditorInner({
  initialNodes: initialNodeDefs,
  initialEdges: initialEdgeDefs,
  onNodesChange: onNodesChangeCallback,
  onEdgesChange: onEdgesChangeCallback,
  onNodeSelect,
  onEdgeSelect,
}: WorkflowGraphEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState(toFlowNodes(initialNodeDefs));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(initialEdgeDefs));

  const nodeTypes = useMemo(() => ({ stepNode: StepNode }), []);
  const edgeTypes = useMemo(() => ({ workflowEdge: WorkflowEdge }), []);

  // Sync state up to parent
  const handleNodesChange: OnNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    // Use setTimeout to batch with React state updates
    setTimeout(() => {
      setNodes((nds) => {
        onNodesChangeCallback(nds);
        return nds;
      });
    }, 0);
  }, [onNodesChange, onNodesChangeCallback, setNodes]);

  const handleEdgesChange: OnEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
    setTimeout(() => {
      setEdges((eds) => {
        onEdgesChangeCallback(eds);
        return eds;
      });
    }, 0);
  }, [onEdgesChange, onEdgesChangeCallback, setEdges]);

  // Connection validation
  const isValidConnection = useCallback((connection: Edge | Connection) => {
    // No self-connections
    if (connection.source === connection.target) return false;
    return true;
  }, []);

  // Handle new connections
  const onConnect = useCallback((connection: Connection) => {
    const edgeType = (connection.sourceHandle ?? 'success') as WorkflowEdgeType;

    // Enforce single outgoing edge per handle type
    setEdges((eds) => {
      // Remove existing edge from same source with same handle
      const filtered = eds.filter(e =>
        !(e.source === connection.source && e.sourceHandle === connection.sourceHandle)
      );
      const newEdge: Edge = {
        id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle,
        type: 'workflowEdge',
        data: {
          edgeType,
          maxIterations: edgeType === 'loop' ? 3 : undefined,
        },
      };
      const result = [...filtered, newEdge];
      onEdgesChangeCallback(result);
      return result;
    });
  }, [setEdges, onEdgesChangeCallback]);

  // Handle node selection
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    onNodeSelect(node.id);
    onEdgeSelect(null);
  }, [onNodeSelect, onEdgeSelect]);

  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    onNodeSelect(null);
    onEdgeSelect(edge.id);
  }, [onNodeSelect, onEdgeSelect]);

  const onPaneClick = useCallback(() => {
    onNodeSelect(null);
    onEdgeSelect(null);
  }, [onNodeSelect, onEdgeSelect]);

  // Handle drop from NodePalette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const nodeType = event.dataTransfer.getData('application/workflow-node-type');
    const nodeLabel = event.dataTransfer.getData('application/workflow-node-label');
    if (!nodeType) return;

    const position = screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const newNodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newNode: Node = {
      id: newNodeId,
      type: 'stepNode',
      position,
      data: {
        label: nodeLabel || nodeType,
        stepType: nodeType,
        onError: 'abort',
        config: {},
        ...(nodeType === 'condition' ? {
          condition: { expression: '' },
        } : {}),
      },
    };

    setNodes((nds) => {
      const result = [...nds, newNode];
      onNodesChangeCallback(result);
      return result;
    });
    onNodeSelect(newNodeId);
    onEdgeSelect(null);
  }, [screenToFlowPosition, setNodes, onNodesChangeCallback, onNodeSelect, onEdgeSelect]);

  // Update a specific node's data (called from parent when config changes)
  const updateNodeData = useCallback((nodeId: string, data: Partial<Record<string, unknown>>) => {
    setNodes((nds) => {
      const result = nds.map(n =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      );
      onNodesChangeCallback(result);
      return result;
    });
  }, [setNodes, onNodesChangeCallback]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => {
      const result = nds.filter(n => n.id !== nodeId);
      onNodesChangeCallback(result);
      return result;
    });
    setEdges((eds) => {
      const result = eds.filter(e => e.source !== nodeId && e.target !== nodeId);
      onEdgesChangeCallback(result);
      return result;
    });
    onNodeSelect(null);
    onEdgeSelect(null);
  }, [setNodes, setEdges, onNodesChangeCallback, onEdgesChangeCallback, onNodeSelect, onEdgeSelect]);

  const updateEdgeData = useCallback((edgeId: string, data: Partial<Record<string, unknown>>) => {
    setEdges((eds) => {
      const result = eds.map((edge) =>
        edge.id === edgeId
          ? { ...edge, data: { ...edge.data, ...data } }
          : edge
      );
      onEdgesChangeCallback(result);
      return result;
    });
  }, [setEdges, onEdgesChangeCallback]);

  // Expose updateNodeData and deleteNode via ref on wrapper div
  if (reactFlowWrapper.current) {
    (reactFlowWrapper.current as any).__updateNodeData = updateNodeData;
    (reactFlowWrapper.current as any).__deleteNode = deleteNode;
    (reactFlowWrapper.current as any).__updateEdgeData = updateEdgeData;
  }

  return (
    <div
      ref={reactFlowWrapper}
      className="flex-1 h-full"
      data-graph-editor
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        isValidConnection={isValidConnection}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        defaultEdgeOptions={{ type: 'workflowEdge' }}
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-background"
      >
        <Background gap={16} size={1} className="!bg-background" />
        <Controls className="!bg-card !border-border !shadow-sm [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-secondary" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor="hsl(var(--muted-foreground) / 0.3)"
          maskColor="hsl(var(--background) / 0.7)"
        />
      </ReactFlow>
    </div>
  );
}

// ── Exported wrapper with ReactFlowProvider ───────────────

export function WorkflowGraphEditor(props: WorkflowGraphEditorProps) {
  return (
    <ReactFlowProvider>
      <GraphEditorInner {...props} />
    </ReactFlowProvider>
  );
}
