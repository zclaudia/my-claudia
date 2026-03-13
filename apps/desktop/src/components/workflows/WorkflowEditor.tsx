import { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Save, PanelLeftClose, PanelLeftOpen, X, ExternalLink, Check } from 'lucide-react';
import type {
  Workflow,
  WorkflowNodeDef,
  WorkflowEdgeDef,
  WorkflowDefinitionV2,
  WorkflowTrigger,
} from '@my-claudia/shared';
import { isV2Definition, migrateV1ToV2 } from '@my-claudia/shared';
import { StepConfigForm } from './StepConfigForm';
import { TriggerConfigForm } from './TriggerConfigForm';
import { NodePalette } from './NodePalette';
import { WorkflowGraphEditor, fromFlowNodes, fromFlowEdges } from './WorkflowGraphEditor';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { Node, Edge } from '@xyflow/react';

const isDesktopTauri = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && !navigator.userAgent.includes('Android');

interface WorkflowEditorProps {
  workflow?: Workflow;
  projectId: string;
  onBack: () => void;
  onSaved: () => void;
  /** When true, editor runs in a standalone pop-out window */
  standalone?: boolean;
  /** Direct server URL for standalone windows (no ConnectionProvider) */
  serverUrl?: string;
  /** Auth token for standalone windows */
  authToken?: string;
}

function getInitialDefinition(workflow?: Workflow): WorkflowDefinitionV2 {
  if (!workflow) {
    return {
      version: 2,
      nodes: [],
      edges: [],
      entryNodeId: '',
      triggers: [{ type: 'manual' }],
    };
  }
  return isV2Definition(workflow.definition)
    ? workflow.definition
    : migrateV1ToV2(workflow.definition);
}

export function WorkflowEditor({ workflow, projectId, onBack, onSaved, standalone, serverUrl, authToken }: WorkflowEditorProps) {
  const { createWorkflow, updateWorkflow, loadStepTypes } = useWorkflowStore();

  useEffect(() => {
    if (!standalone) loadStepTypes();
  }, [standalone]);

  const initial = getInitialDefinition(workflow);

  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [triggers, setTriggers] = useState<WorkflowTrigger[]>(initial.triggers);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  // Track workflow ID for standalone mode (may be assigned after first create)
  const [workflowId, setWorkflowId] = useState<string | undefined>(workflow?.id);

  // Keep latest nodes/edges via refs (updated by graph editor callbacks)
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  // Also track as state for re-rendering the config panel
  const [, setCurrentNodes] = useState<WorkflowNodeDef[]>(initial.nodes);
  const [, setCurrentEdges] = useState<WorkflowEdgeDef[]>(initial.edges);

  const onNodesChange = useCallback((nodes: Node[]) => {
    nodesRef.current = nodes;
    setCurrentNodes(fromFlowNodes(nodes));
  }, []);

  const onEdgesChange = useCallback((edges: Edge[]) => {
    edgesRef.current = edges;
    setCurrentEdges(fromFlowEdges(edges));
  }, []);

  const onNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) setSelectedEdgeId(null);
  }, []);

  const onEdgeSelect = useCallback((edgeId: string | null) => {
    setSelectedEdgeId(edgeId);
    if (edgeId) setSelectedNodeId(null);
  }, []);

  // Build full node data from nodesRef for the selected node
  const selectedFlowNode = selectedNodeId
    ? nodesRef.current.find(n => n.id === selectedNodeId)
    : null;
  const selectedFlowEdge = selectedEdgeId
    ? edgesRef.current.find(e => e.id === selectedEdgeId)
    : null;

  const updateSelectedNode = useCallback((updated: WorkflowNodeDef) => {
    // Update graph editor node data
    const editorEl = document.querySelector('[data-graph-editor]');
    if (editorEl && (editorEl as any).__updateNodeData) {
      (editorEl as any).__updateNodeData(updated.id, {
        label: updated.name,
        stepType: updated.type,
        onError: updated.onError,
        config: updated.config,
        retryCount: updated.retryCount,
        timeoutMs: updated.timeoutMs,
        condition: updated.condition,
      });
    }
  }, []);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    const editorEl = document.querySelector('[data-graph-editor]');
    if (editorEl && (editorEl as any).__deleteNode) {
      (editorEl as any).__deleteNode(selectedNodeId);
    }
  }, [selectedNodeId]);

  const updateSelectedEdge = useCallback((edgeId: string, data: Partial<Record<string, unknown>>) => {
    const editorEl = document.querySelector('[data-graph-editor]');
    if (editorEl && (editorEl as any).__updateEdgeData) {
      (editorEl as any).__updateEdgeData(edgeId, data);
    }
  }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      const nodes = fromFlowNodes(nodesRef.current);
      const edges = fromFlowEdges(edgesRef.current);

      // Determine entryNodeId: find nodes with no incoming edges
      const targetIds = new Set(edges.map(e => e.target));
      const entryNodes = nodes.filter(n => !targetIds.has(n.id));
      const entryNodeId = entryNodes[0]?.id ?? nodes[0]?.id ?? '';

      const definition: WorkflowDefinitionV2 = {
        version: 2,
        nodes,
        edges,
        entryNodeId,
        triggers,
      };

      if (standalone && serverUrl) {
        // Direct API calls for standalone window
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = authToken;

        if (workflowId) {
          const resp = await fetch(`${serverUrl}/api/workflows/${workflowId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ name, description: description || undefined, definition, projectId }),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        } else {
          const resp = await fetch(`${serverUrl}/api/projects/${projectId}/workflows`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name, description: description || undefined, definition }),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const json = await resp.json();
          if (json.data?.id) setWorkflowId(json.data.id);
        }
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        if (workflow) {
          await updateWorkflow(workflow.id, projectId, { name, description: description || undefined, definition });
        } else {
          await createWorkflow(projectId, { name, description: description || undefined, definition });
        }
        onSaved();
      }
    } catch (err) {
      console.error('[WorkflowEditor] Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handlePopOut = async () => {
    if (!isDesktopTauri) return;
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { getBaseUrl, getAuthHeaders } = await import('../../services/api');
      const label = `workflow-editor-${Date.now()}`;
      let sUrl = '';
      try { sUrl = getBaseUrl(); } catch {}
      const aHeaders = getAuthHeaders();
      const aToken = (aHeaders as Record<string, string>)['Authorization'] || '';

      const params = new URLSearchParams({ workflowEditor: projectId, serverUrl: sUrl });
      if (workflow?.id) params.set('workflowId', workflow.id);
      if (aToken) params.set('authToken', aToken);
      const url = `${window.location.origin}${window.location.pathname}?${params}`;

      new WebviewWindow(label, {
        url,
        title: workflow ? `Edit: ${workflow.name}` : 'New Workflow',
        width: 1100,
        height: 700,
        center: true,
        dragDropEnabled: false,
      });

      // Go back to list in main window
      onBack();
    } catch (err) {
      console.error('[WorkflowEditor] Pop out failed:', err);
    }
  };

  // Build the full node def for config panel (merge flow node data with stored config)
  const getFullNodeDef = (): WorkflowNodeDef | null => {
    if (!selectedFlowNode) return null;
    const d = selectedFlowNode.data;
    return {
      id: selectedFlowNode.id,
      name: (d.label as string) ?? '',
      type: (d.stepType as string) ?? '',
      config: (d.config as Record<string, unknown>) ?? {},
      position: selectedFlowNode.position,
      onError: d.onError as any,
      retryCount: d.retryCount as number | undefined,
      timeoutMs: d.timeoutMs as number | undefined,
      condition: d.condition as any,
    };
  };

  const getFullEdgeDef = (): WorkflowEdgeDef | null => {
    if (!selectedFlowEdge) return null;
    return {
      id: selectedFlowEdge.id,
      source: selectedFlowEdge.source,
      target: selectedFlowEdge.target,
      type: (selectedFlowEdge.data?.edgeType ?? selectedFlowEdge.sourceHandle ?? 'success') as WorkflowEdgeDef['type'],
      maxIterations: typeof selectedFlowEdge.data?.maxIterations === 'number'
        ? selectedFlowEdge.data.maxIterations
        : undefined,
    };
  };

  const fullSelectedNode = getFullNodeDef();
  const fullSelectedEdge = getFullEdgeDef();
  const editorLabel = workflow ? 'Edit Workflow' : 'Editor';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border">
        {!standalone && (
          <div className="flex items-center gap-2 px-3 py-2">
            <button
              onClick={onBack}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0"
              title="Back to Workflows"
            >
              <ArrowLeft size={14} />
            </button>
            <span className="text-xs text-muted-foreground">Dashboard</span>
            <span className="text-xs text-muted-foreground/60">/</span>
            <button
              onClick={onBack}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Workflows
            </button>
            <span className="text-xs text-muted-foreground/60">/</span>
            <span className="text-xs font-medium text-foreground">{editorLabel}</span>
          </div>
        )}

        <div className={`flex items-center gap-2 px-3 ${standalone ? 'py-2' : 'pb-2'}`} data-tauri-drag-region={standalone}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow name..."
            className="text-sm font-medium bg-transparent border-none outline-none placeholder:text-muted-foreground min-w-0 w-48"
          />
          <span className="text-muted-foreground/30 shrink-0">|</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="text-xs bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/40 flex-1 min-w-0"
          />
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-500 shrink-0">
              <Check size={12} /> Saved
            </span>
          )}
          {!standalone && isDesktopTauri && (
            <button
              onClick={handlePopOut}
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground shrink-0"
              title="Open in new window"
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Collapsible panel */}
        {leftPanelOpen ? (
          <div className="w-44 border-r border-border overflow-y-auto p-2.5 flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Toolbox</span>
              <button
                onClick={() => setLeftPanelOpen(false)}
                className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                title="Collapse panel"
              >
                <PanelLeftClose size={14} />
              </button>
            </div>
            <NodePalette />
            <hr className="border-border" />
            <TriggerConfigForm triggers={triggers} onChange={setTriggers} />
          </div>
        ) : (
          <div className="w-8 border-r border-border flex flex-col items-center pt-2 shrink-0">
            <button
              onClick={() => setLeftPanelOpen(true)}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
              title="Expand panel"
            >
              <PanelLeftOpen size={14} />
            </button>
          </div>
        )}

        {/* Center: Graph editor canvas — takes all remaining space */}
        <WorkflowGraphEditor
          initialNodes={initial.nodes}
          initialEdges={initial.edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeSelect={onNodeSelect}
          onEdgeSelect={onEdgeSelect}
        />

        {/* Right: Config panel — visible for selected node or selected loop edge */}
        {(fullSelectedNode || fullSelectedEdge) && (
          <div className="w-72 border-l border-border overflow-y-auto p-3 bg-card/50 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Config</span>
              <button
                onClick={() => {
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
                }}
                className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                title="Close panel"
              >
                <X size={14} />
              </button>
            </div>
            {fullSelectedNode ? (
              <StepConfigForm
                step={fullSelectedNode}
                onChange={updateSelectedNode}
                onDelete={deleteSelectedNode}
              />
            ) : fullSelectedEdge ? (
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-foreground">Loop Edge</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {fullSelectedEdge.source} {'->'} {fullSelectedEdge.target}
                  </div>
                </div>
                {fullSelectedEdge.type === 'loop' ? (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Max Iterations</label>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={fullSelectedEdge.maxIterations ?? 3}
                      onChange={(e) => {
                        const nextValue = Number.parseInt(e.target.value, 10);
                        updateSelectedEdge(fullSelectedEdge.id, {
                          maxIterations: Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 1,
                        });
                      }}
                      className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Number of times this loop edge may revisit its target before taking `loop_exhausted`.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Only `loop` edges have editable settings right now.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
