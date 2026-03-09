import type { WorkflowNodeDef, WorkflowStepOnError, BuiltinWorkflowStepType } from '@my-claudia/shared';
import { useWorkflowStore } from '../../stores/workflowStore';
import { JsonSchemaConfigForm } from './JsonSchemaConfigForm';

interface StepConfigFormProps {
  step: WorkflowNodeDef;
  onChange: (step: WorkflowNodeDef) => void;
  onDelete: () => void;
}

const BUILTIN_STEP_TYPE_LABELS: Record<BuiltinWorkflowStepType, string> = {
  git_commit: 'Git Commit',
  git_merge: 'Git Merge',
  create_worktree: 'Create Worktree',
  create_pr: 'Create PR',
  ai_review: 'AI Review',
  ai_prompt: 'AI Prompt',
  shell: 'Shell Command',
  webhook: 'Webhook',
  condition: 'Condition',
  notify: 'Notify',
  wait: 'Wait / Approval',
};

function getStepTypeLabel(type: string): string {
  const builtin = BUILTIN_STEP_TYPE_LABELS[type as BuiltinWorkflowStepType];
  if (builtin) return builtin;
  const meta = useWorkflowStore.getState().stepTypes.find((s) => s.type === type);
  return meta?.name ?? type;
}

function updateConfig(step: WorkflowNodeDef, key: string, value: unknown): WorkflowNodeDef {
  return { ...step, config: { ...step.config, [key]: value } };
}

function TextInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary"
      />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 3 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary resize-none font-mono"
      />
      <p className="text-xs text-muted-foreground mt-0.5">
        Use {'${stepId.output.field}'} to reference previous step outputs
      </p>
    </div>
  );
}

function renderTypeConfig(step: WorkflowNodeDef, onChange: (s: WorkflowNodeDef) => void) {
  switch (step.type) {
    case 'shell':
      return (
        <>
          <TextArea
            label="Command"
            value={(step.config.command as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'command', v))}
            placeholder="npm run test"
          />
          <TextInput
            label="Working Directory"
            value={(step.config.cwd as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'cwd', v))}
            placeholder="(project root)"
          />
        </>
      );

    case 'ai_prompt':
      return (
        <>
          <TextArea
            label="Prompt"
            value={(step.config.prompt as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'prompt', v))}
            placeholder="Review the code changes..."
            rows={5}
          />
          <TextInput
            label="Session Name"
            value={(step.config.sessionName as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'sessionName', v))}
            placeholder="(auto-generated)"
          />
        </>
      );

    case 'ai_review':
      return (
        <TextInput
          label="Worktree Path"
          value={(step.config.worktreePath as string) ?? ''}
          onChange={(v) => onChange(updateConfig(step, 'worktreePath', v))}
          placeholder="(project root)"
        />
      );

    case 'git_commit':
      return (
        <>
          <TextInput
            label="Worktree Path"
            value={(step.config.worktreePath as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'worktreePath', v))}
            placeholder="(project root)"
          />
          <TextInput
            label="Commit Message"
            value={(step.config.message as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'message', v))}
            placeholder="(auto-generated from diff)"
          />
        </>
      );

    case 'git_merge':
      return (
        <>
          <TextInput
            label="Branch to Merge"
            value={(step.config.branch as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'branch', v))}
            placeholder="feature-branch"
          />
          <TextInput
            label="Base Branch"
            value={(step.config.baseBranch as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'baseBranch', v))}
            placeholder="main"
          />
        </>
      );

    case 'create_worktree':
      return (
        <>
          <TextInput
            label="Branch Name"
            value={(step.config.branchName as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'branchName', v))}
            placeholder="feature/new-feature"
          />
          <TextInput
            label="Base Branch"
            value={(step.config.baseBranch as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'baseBranch', v))}
            placeholder="main"
          />
        </>
      );

    case 'create_pr':
      return (
        <>
          <TextInput
            label="Title"
            value={(step.config.title as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'title', v))}
            placeholder="(auto-generated)"
          />
          <TextInput
            label="Base Branch"
            value={(step.config.baseBranch as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'baseBranch', v))}
            placeholder="main"
          />
        </>
      );

    case 'webhook':
      return (
        <>
          <TextInput
            label="URL"
            value={(step.config.url as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'url', v))}
            placeholder="https://example.com/webhook"
          />
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Method</label>
            <select
              value={(step.config.method as string) ?? 'POST'}
              onChange={(e) => onChange(updateConfig(step, 'method', e.target.value))}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
          </div>
        </>
      );

    case 'notify':
      return (
        <>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Type</label>
            <select
              value={(step.config.type as string) ?? 'system'}
              onChange={(e) => onChange(updateConfig(step, 'type', e.target.value))}
              className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
            >
              <option value="system">System</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>
          <TextArea
            label="Message"
            value={(step.config.message as string) ?? ''}
            onChange={(v) => onChange(updateConfig(step, 'message', v))}
            placeholder="Workflow notification..."
          />
        </>
      );

    case 'condition':
      return (
        <TextInput
          label="Expression"
          value={step.condition?.expression ?? ''}
          onChange={(v) => onChange({ ...step, condition: { expression: v } })}
          placeholder="${review.output.reviewPassed} == true"
        />
      );

    case 'wait':
      return (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Wait Type</label>
          <select
            value={(step.config.type as string) ?? 'approval'}
            onChange={(e) => onChange(updateConfig(step, 'type', e.target.value))}
            className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
          >
            <option value="approval">Manual Approval</option>
            <option value="timeout">Timeout (wait)</option>
          </select>
        </div>
      );

    default: {
      // Check if this is a plugin step type with a JSON Schema config
      const meta = useWorkflowStore.getState().stepTypes.find((s) => s.type === step.type);
      if (meta?.configSchema) {
        return (
          <JsonSchemaConfigForm
            schema={meta.configSchema}
            config={step.config}
            onChange={(newConfig) => onChange({ ...step, config: newConfig })}
          />
        );
      }
      return <p className="text-xs text-muted-foreground">No configuration available for this step type.</p>;
    }
  }
}

export function StepConfigForm({ step, onChange, onDelete }: StepConfigFormProps) {
  const onErrorOptions: WorkflowStepOnError[] = ['abort', 'skip', 'retry', 'route'];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Node Configuration</h3>
        <button
          onClick={onDelete}
          className="text-xs text-destructive hover:text-destructive/80 transition-colors"
        >
          Delete Node
        </button>
      </div>

      <TextInput
        label="Name"
        value={step.name}
        onChange={(v) => onChange({ ...step, name: v })}
        placeholder="Step name"
      />

      <TextInput
        label="Node ID"
        value={step.id}
        onChange={(v) => onChange({ ...step, id: v })}
        placeholder="node_1"
      />

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Type</label>
        <div className="text-sm px-2.5 py-1.5 rounded-md bg-muted">
          {getStepTypeLabel(step.type)}
        </div>
      </div>

      <hr className="border-border" />

      {renderTypeConfig(step, onChange)}

      <hr className="border-border" />

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">On Error</label>
        <div className="flex flex-wrap gap-2">
          {onErrorOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => onChange({ ...step, onError: opt })}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                (step.onError ?? 'abort') === opt
                  ? opt === 'route'
                    ? 'border-orange-500 bg-orange-500/10 text-orange-600'
                    : 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:bg-secondary'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        {step.onError === 'route' && (
          <p className="text-xs text-orange-500 mt-1.5">
            Connect the red Error handle to a target node on the canvas
          </p>
        )}
      </div>

      {step.onError === 'retry' && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Max Retries</label>
          <input
            type="number"
            min={1}
            max={10}
            value={step.retryCount ?? 1}
            onChange={(e) => onChange({ ...step, retryCount: parseInt(e.target.value) || 1 })}
            className="w-20 px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
          />
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Timeout (seconds)</label>
        <input
          type="number"
          min={5}
          value={Math.floor((step.timeoutMs ?? 600000) / 1000)}
          onChange={(e) => onChange({ ...step, timeoutMs: (parseInt(e.target.value) || 600) * 1000 })}
          className="w-24 px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
        />
      </div>
    </div>
  );
}
