import { useMemo } from 'react';
import { useWorkflowStore } from '../../stores/workflowStore';
import { getStepIcon } from './nodes/StepNode';
import type { BuiltinWorkflowStepType } from '@my-claudia/shared';

const BUILTIN_STEP_CATEGORIES: { label: string; steps: { type: string; label: string }[] }[] = [
  {
    label: 'Git',
    steps: [
      { type: 'git_commit', label: 'Git Commit' },
      { type: 'git_merge', label: 'Git Merge' },
      { type: 'create_worktree', label: 'Create Worktree' },
      { type: 'create_pr', label: 'Create PR' },
    ],
  },
  {
    label: 'AI',
    steps: [
      { type: 'ai_review', label: 'AI Review' },
      { type: 'ai_prompt', label: 'AI Prompt' },
    ],
  },
  {
    label: 'Automation',
    steps: [
      { type: 'shell', label: 'Shell Command' },
      { type: 'webhook', label: 'Webhook' },
      { type: 'notify', label: 'Notify' },
    ],
  },
  {
    label: 'Flow Control',
    steps: [
      { type: 'condition', label: 'Condition' },
      { type: 'wait', label: 'Wait / Approval' },
    ],
  },
];

export function NodePalette() {
  const { stepTypes } = useWorkflowStore();

  const categories = useMemo(() => {
    const cats = BUILTIN_STEP_CATEGORIES.map(c => ({ ...c, steps: [...c.steps] }));
    const pluginSteps = stepTypes.filter(s => s.source !== 'builtin');

    for (const step of pluginSteps) {
      const catLabel = step.category || 'Plugins';
      const existing = cats.find(c => c.label.toLowerCase() === catLabel.toLowerCase());
      if (existing) {
        existing.steps.push({ type: step.type, label: step.name });
      } else {
        cats.push({ label: catLabel, steps: [{ type: step.type, label: step.name }] });
      }
    }
    return cats;
  }, [stepTypes]);

  const onDragStart = (event: React.DragEvent, nodeType: string, label: string) => {
    event.dataTransfer.setData('application/workflow-node-type', nodeType);
    event.dataTransfer.setData('application/workflow-node-label', label);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Drag to add
      </h3>
      {categories.map(cat => (
        <div key={cat.label}>
          <div className="text-[11px] font-medium text-muted-foreground mb-1.5">{cat.label}</div>
          <div className="space-y-1">
            {cat.steps.map(step => (
              <div
                key={step.type}
                draggable
                onDragStart={(e) => onDragStart(e, step.type, step.label)}
                className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md cursor-grab border border-border hover:bg-secondary active:cursor-grabbing transition-colors"
              >
                <span className="text-muted-foreground">{getStepIcon(step.type)}</span>
                {step.label}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
