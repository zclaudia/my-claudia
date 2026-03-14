/**
 * Auto-layout utility for workflow graph nodes.
 *
 * Uses BFS from entry node to assign layer-based positions.
 * Nodes are arranged vertically (top-to-bottom) with horizontal spreading for branches.
 */

import type { WorkflowNodeDef, WorkflowEdgeDef } from '@my-claudia/shared';

const LAYER_GAP_Y = 150;
const NODE_GAP_X = 250;
const CENTER_X = 300;

/**
 * Assigns positions to workflow nodes using BFS layering from the entry node.
 * Returns a new array of nodes with updated positions (does not mutate input).
 */
export function autoLayoutGraph(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  entryNodeId: string,
): WorkflowNodeDef[] {
  if (nodes.length === 0) return [];

  // Build adjacency: source → target nodes
  const adj = new Map<string, string[]>();
  for (const node of nodes) adj.set(node.id, []);
  for (const edge of edges) {
    const targets = adj.get(edge.source);
    if (targets && !targets.includes(edge.target)) {
      targets.push(edge.target);
    }
  }

  // BFS to assign layers
  const layerMap = new Map<string, number>();
  const queue: string[] = [];

  if (adj.has(entryNodeId)) {
    queue.push(entryNodeId);
    layerMap.set(entryNodeId, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layerMap.get(current)!;
    for (const target of adj.get(current) ?? []) {
      if (!layerMap.has(target)) {
        layerMap.set(target, currentLayer + 1);
        queue.push(target);
      }
    }
  }

  // Assign any unreachable nodes to the last layer + 1
  let maxLayer = 0;
  for (const layer of layerMap.values()) {
    if (layer > maxLayer) maxLayer = layer;
  }
  for (const node of nodes) {
    if (!layerMap.has(node.id)) {
      layerMap.set(node.id, maxLayer + 1);
    }
  }

  // Group nodes by layer
  const layers = new Map<number, string[]>();
  for (const [nodeId, layer] of layerMap) {
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(nodeId);
  }

  // Assign positions: center each layer horizontally
  const positionMap = new Map<string, { x: number; y: number }>();
  for (const [layer, nodeIds] of layers) {
    const count = nodeIds.length;
    const totalWidth = (count - 1) * NODE_GAP_X;
    const startX = CENTER_X - totalWidth / 2;
    for (let i = 0; i < count; i++) {
      positionMap.set(nodeIds[i], {
        x: startX + i * NODE_GAP_X,
        y: layer * LAYER_GAP_Y,
      });
    }
  }

  return nodes.map(node => ({
    ...node,
    position: positionMap.get(node.id) ?? node.position,
  }));
}
