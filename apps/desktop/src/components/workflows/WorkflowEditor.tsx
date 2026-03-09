import { useState, useCallback, useEffect, useMemo } from 'react';
import { ArrowLeft, Save, Plus, GripVertical, ArrowDown, ChevronUp, ChevronDown, GitCommit, GitMerge, GitBranch, GitPullRequest, Bot, Terminal, Globe, Bell, HelpCircle, Pause, Puzzle } from 'lucide-react';
import type { Workflow, WorkflowStepDef, WorkflowDefinition, WorkflowTrigger, BuiltinWorkflowStepType } from '@my-claudia/shared';
import { StepConfigForm } from './StepConfigForm';
import { TriggerConfigForm } from './TriggerConfigForm';
import { useWorkflowStore } from '../../stores/workflowStore';

interface WorkflowEditorProps {
  workflow?: Workflow;
  projectId: string;
  onBack: () => void;
  onSaved: () => void;
}

const BUILTIN_STEP_ICONS: Record<BuiltinWorkflowStepType, React.ReactNode> = {
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

function getStepIcon(type: string): React.ReactNode {
  const builtin = BUILTIN_STEP_ICONS[type as BuiltinWorkflowStepType];
  if (builtin) return builtin;
  return <Puzzle size={14} />;
}

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

function generateStepId(steps: WorkflowStepDef[]): string {
  const maxNum = steps.reduce((max, s) => {
    const match = s.id.match(/^step_(\d+)$/);
    return match ? Math.max(max, parseInt(match[1])) : max;
  }, 0);
  return `step_${maxNum + 1}`;
}

export function WorkflowEditor({ workflow, projectId, onBack, onSaved }: WorkflowEditorProps) {
  const { createWorkflow, updateWorkflow, stepTypes, loadStepTypes } = useWorkflowStore();

  useEffect(() => {
    loadStepTypes();
  }, []);

  // Build dynamic step categories: builtin + plugin steps grouped by category
  const stepCategories = useMemo(() => {
    const categories = BUILTIN_STEP_CATEGORIES.map((c) => ({ ...c, steps: [...c.steps] }));
    const pluginSteps = stepTypes.filter((s) => s.source !== 'builtin');

    for (const step of pluginSteps) {
      const catLabel = step.category || 'Plugins';
      const existing = categories.find((c) => c.label.toLowerCase() === catLabel.toLowerCase());
      if (existing) {
        existing.steps.push({ type: step.type, label: step.name });
      } else {
        categories.push({ label: catLabel, steps: [{ type: step.type, label: step.name }] });
      }
    }
    return categories;
  }, [stepTypes]);

  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [steps, setSteps] = useState<WorkflowStepDef[]>(workflow?.definition.steps ?? []);
  const [triggers, setTriggers] = useState<WorkflowTrigger[]>(workflow?.definition.triggers ?? []);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showAddStep, setShowAddStep] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedStep = steps.find((s) => s.id === selectedStepId) ?? null;

  const addStep = useCallback((type: string, label: string) => {
    const id = generateStepId(steps);
    const newStep: WorkflowStepDef = {
      id,
      name: label,
      type,
      config: {},
      onError: 'abort',
      ...(type === 'condition' ? {
        condition: { expression: '', thenSteps: [], elseSteps: [] },
      } : {}),
    };
    setSteps((prev) => [...prev, newStep]);
    setSelectedStepId(id);
    setShowAddStep(false);
  }, [steps]);

  const updateStep = useCallback((updated: WorkflowStepDef) => {
    setSteps((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  const deleteStep = useCallback((stepId: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
    if (selectedStepId === stepId) setSelectedStepId(null);
  }, [selectedStepId]);

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const newSteps = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= newSteps.length) return prev;
      [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
      return newSteps;
    });
  }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const definition: WorkflowDefinition = { steps, triggers };
      if (workflow) {
        await updateWorkflow(workflow.id, projectId, { name, description: description || undefined, definition });
      } else {
        await createWorkflow(projectId, { name, description: description || undefined, definition });
      }
      onSaved();
    } catch (err) {
      console.error('[WorkflowEditor] Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow name..."
            className="text-sm font-medium bg-transparent border-none outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="px-4 py-2 border-b border-border">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="w-full text-xs bg-transparent border-none outline-none text-muted-foreground placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Main editor area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Steps canvas */}
        <div className="flex-1 overflow-y-auto p-4 border-r border-border">
          <div className="space-y-1">
            {steps.map((step, index) => {
              const isSelected = step.id === selectedStepId;
              const isCondition = step.type === 'condition';

              return (
                <div key={step.id}>
                  {/* Connection line */}
                  {index > 0 && (
                    <div className="flex justify-center py-1">
                      <ArrowDown size={14} className="text-muted-foreground/30" />
                    </div>
                  )}

                  {/* Step card */}
                  <div
                    onClick={() => setSelectedStepId(step.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                  >
                    {/* Drag handle + reorder buttons */}
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); moveStep(index, -1); }}
                        disabled={index === 0}
                        className="p-0.5 rounded hover:bg-secondary disabled:opacity-20"
                      >
                        <ChevronUp size={10} />
                      </button>
                      <GripVertical size={12} className="text-muted-foreground/40" />
                      <button
                        onClick={(e) => { e.stopPropagation(); moveStep(index, 1); }}
                        disabled={index === steps.length - 1}
                        className="p-0.5 rounded hover:bg-secondary disabled:opacity-20"
                      >
                        <ChevronDown size={10} />
                      </button>
                    </div>

                    {/* Step icon + info */}
                    <div className="text-muted-foreground shrink-0">
                      {getStepIcon(step.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{step.name}</div>
                      <div className="text-xs text-muted-foreground">{step.type}</div>
                    </div>
                  </div>

                  {/* Condition branches */}
                  {isCondition && step.condition && (
                    <div className="ml-8 mt-1 flex gap-2">
                      <div className="flex-1 p-2 rounded border border-green-500/30 bg-green-500/5">
                        <div className="text-xs text-green-600 font-medium mb-1">Then</div>
                        {step.condition.thenSteps.length > 0 ? (
                          step.condition.thenSteps.map((id) => (
                            <div key={id} className="text-xs text-muted-foreground">{id}</div>
                          ))
                        ) : (
                          <div className="text-xs text-muted-foreground/50">—</div>
                        )}
                      </div>
                      <div className="flex-1 p-2 rounded border border-red-500/30 bg-red-500/5">
                        <div className="text-xs text-red-600 font-medium mb-1">Else</div>
                        {step.condition.elseSteps.length > 0 ? (
                          step.condition.elseSteps.map((id) => (
                            <div key={id} className="text-xs text-muted-foreground">{id}</div>
                          ))
                        ) : (
                          <div className="text-xs text-muted-foreground/50">—</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add step */}
          {showAddStep ? (
            <div className="mt-3 border border-dashed border-border rounded-lg p-3">
              {stepCategories.map((cat) => (
                <div key={cat.label} className="mb-2">
                  <div className="text-xs font-medium text-muted-foreground mb-1">{cat.label}</div>
                  <div className="flex flex-wrap gap-1">
                    {cat.steps.map(({ type, label }) => (
                      <button
                        key={type}
                        onClick={() => addStep(type, label)}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border hover:bg-secondary transition-colors"
                      >
                        {getStepIcon(type)}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={() => setShowAddStep(false)}
                className="mt-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddStep(true)}
              className="mt-3 flex items-center gap-1 w-full justify-center py-2.5 text-xs rounded-lg border border-dashed border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus size={14} />
              Add Step
            </button>
          )}

          {/* Triggers section */}
          <div className="mt-6 pt-4 border-t border-border">
            <TriggerConfigForm triggers={triggers} onChange={setTriggers} />
          </div>
        </div>

        {/* Right: Step config panel */}
        <div className="w-80 overflow-y-auto p-4 bg-card/50">
          {selectedStep ? (
            <StepConfigForm
              step={selectedStep}
              onChange={updateStep}
              onDelete={() => deleteStep(selectedStep.id)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <div className="text-sm">Select a step to configure</div>
              <div className="text-xs mt-1">or add a new step to get started</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
