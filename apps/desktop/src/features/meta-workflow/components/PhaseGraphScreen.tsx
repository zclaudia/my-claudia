// apps/desktop/src/features/meta-workflow/components/PhaseGraphScreen.tsx
import React, { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MetaWorkflowRun, PhasesDoc, MetaWorkflowPhase } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#f3f4f6',
  searching_reuse: '#dbeafe',
  generating: '#bfdbfe',
  ready_to_run: '#fef9c3',
  running: '#fde68a',
  verifying_gates: '#fed7aa',
  done: '#bbf7d0',
  failed: '#fecaca',
  stale: '#e9d5ff',
};

function toFlow(doc: PhasesDoc, phases: MetaWorkflowPhase[]): { nodes: Node[]; edges: Edge[] } {
  const statusByPhaseId: Record<string, string> = {};
  for (const p of phases) statusByPhaseId[p.phaseId] = p.status;

  // Simple horizontal layout: phases without dependsOn at x=0, others stepped right.
  const depth: Record<string, number> = {};
  function calcDepth(id: string): number {
    if (depth[id] !== undefined) return depth[id];
    const def = doc.phases.find((p) => p.id === id);
    if (!def || def.dependsOn.length === 0) { depth[id] = 0; return 0; }
    depth[id] = Math.max(...def.dependsOn.map((d) => calcDepth(d))) + 1;
    return depth[id];
  }
  doc.phases.forEach((p) => calcDepth(p.id));

  const byDepth: Record<number, string[]> = {};
  for (const [id, d] of Object.entries(depth)) {
    byDepth[d] = byDepth[d] ?? [];
    byDepth[d].push(id);
  }

  const nodes: Node[] = doc.phases.map((p) => {
    const d = depth[p.id];
    const lane = byDepth[d].indexOf(p.id);
    const status = statusByPhaseId[p.id] ?? 'pending';
    return {
      id: p.id,
      position: { x: d * 220, y: lane * 100 },
      data: {
        label: (
          <div style={{ padding: 6 }}>
            <div style={{ fontWeight: 600 }}>{p.id}</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>{p.phaseType}</div>
            <div style={{ fontSize: 10, fontFamily: 'monospace' }}>{status}</div>
          </div>
        ),
      },
      style: { background: STATUS_COLOR[status] ?? '#fff', border: '1px solid #cbd5e1', borderRadius: 6, width: 180 },
    };
  });

  const edges: Edge[] = [];
  for (const p of doc.phases) {
    for (const dep of p.dependsOn) {
      edges.push({ id: `${dep}->${p.id}`, source: dep, target: p.id, animated: false });
    }
  }
  return { nodes, edges };
}

export function PhaseGraphScreen({ projectId, run, socket: _socket }: Props): React.ReactElement {
  const phases = useMetaWorkflowStore((s) => s.phases[run.id] ?? []);
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  const { nodes, edges } = useMemo(() => {
    if (!run.phasesJson) return { nodes: [], edges: [] };
    try {
      const doc = JSON.parse(run.phasesJson) as PhasesDoc;
      return toFlow(doc, phases);
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [run.phasesJson, phases]);

  if (!run.phasesJson) {
    return (
      <div>
        <h3 className="text-lg font-semibold mb-3">Phase Graph — {run.title}</h3>
        <div className="text-sm text-muted-foreground">Run has no phases.json yet. Approve requirements to enter splitting.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Phase Graph — {run.title}</h3>
        <button className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
                onClick={() => patchView(projectId, { screen: 'phase-board' })}>
          View Board
        </button>
      </div>
      <div className="h-[500px] border border-border rounded-md">
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
