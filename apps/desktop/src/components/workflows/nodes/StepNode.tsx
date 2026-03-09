import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitCommit, GitMerge, GitBranch, GitPullRequest, Bot, Terminal, Globe, Bell, HelpCircle, Pause, Puzzle } from 'lucide-react';
import type { BuiltinWorkflowStepType } from '@my-claudia/shared';

const STEP_ICONS: Record<BuiltinWorkflowStepType, React.ReactNode> = {
  git_commit: <GitCommit size={14} />,
  git_merge: <GitMerge size={14} />,
  create_worktree: <GitBranch size={14} />,
  create_pr: <GitPullRequest size={14} />,
  ai_review: <Bot size={14} />,
  ai_prompt: <Bot size={14} />,
  shell: <Terminal size={14} />,
  webhook: <Globe size={14} />,
  condition: <HelpCircle size={14} />,
  notify: <Bell size={14} />,
  wait: <Pause size={14} />,
};

export function getStepIcon(type: string): React.ReactNode {
  return STEP_ICONS[type as BuiltinWorkflowStepType] ?? <Puzzle size={14} />;
}

export interface StepNodeData {
  label: string;
  stepType: string;
  onError?: string;
  [key: string]: unknown;
}

export const StepNode = memo(function StepNode({ data, selected }: NodeProps) {
  const nodeData = data as StepNodeData;
  const isCondition = nodeData.stepType === 'condition';
  const hasErrorRoute = nodeData.onError === 'route';

  return (
    <div className={`px-4 py-3 rounded-lg border-2 shadow-sm min-w-[180px] transition-colors ${
      selected ? 'border-primary bg-primary/5' : 'border-border bg-card'
    }`}>
      {/* Target handle: incoming connection */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-background"
      />

      {/* Node content */}
      <div className="flex items-center gap-2">
        <div className="text-muted-foreground shrink-0">
          {getStepIcon(nodeData.stepType)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{nodeData.label}</div>
          <div className="text-[11px] text-muted-foreground">{nodeData.stepType}</div>
        </div>
      </div>

      {/* Error route indicator */}
      {hasErrorRoute && (
        <div className="text-[10px] text-orange-500 mt-1 font-medium">Error route enabled</div>
      )}

      {/* Source handles */}
      {isCondition ? (
        <>
          {/* True branch: bottom-left */}
          <Handle
            type="source"
            position={Position.Bottom}
            id="condition_true"
            className="!w-3 !h-3 !bg-green-500 !border-2 !border-background"
            style={{ left: '30%' }}
          />
          <span className="absolute text-[9px] text-green-600 font-medium" style={{ bottom: -16, left: '22%' }}>
            True
          </span>
          {/* False branch: bottom-right */}
          <Handle
            type="source"
            position={Position.Bottom}
            id="condition_false"
            className="!w-3 !h-3 !bg-red-500 !border-2 !border-background"
            style={{ left: '70%' }}
          />
          <span className="absolute text-[9px] text-red-600 font-medium" style={{ bottom: -16, left: '62%' }}>
            False
          </span>
        </>
      ) : (
        <>
          {/* Success: bottom center */}
          <Handle
            type="source"
            position={Position.Bottom}
            id="success"
            className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-background"
          />
          {/* Error: right side (only when onError == 'route') */}
          {hasErrorRoute && (
            <Handle
              type="source"
              position={Position.Right}
              id="error"
              className="!w-3 !h-3 !bg-red-500 !border-2 !border-background"
            />
          )}
        </>
      )}
    </div>
  );
});
