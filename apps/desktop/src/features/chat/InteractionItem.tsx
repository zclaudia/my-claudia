import { memo, useState, useCallback } from 'react';
import { CheckCircle2, Loader2, Square, ListTodo, FileQuestion, Send, Check, ShieldAlert, ThumbsUp, ThumbsDown, ClipboardCheck, Maximize2, Minimize2, Bookmark } from 'lucide-react';
import type { InteractionMessage, InteractionPromptMessage, InteractionPromptField, ApprovalInteractionMessage, PlanReviewInteractionMessage } from '@my-claudia/shared';
import { ACTIONABLE_LABEL, extractDefaultTitleFromPlan } from '@my-claudia/shared';
import { useConnection } from '../../contexts/ConnectionContext';
import { useLocalIssueStore } from '../local-issues/store';
import { useProjectStore } from '../../stores/projectStore';
import { SavePlanAsIssueDialog } from './SavePlanAsIssueDialog';
import { useChatActionsOptional } from './ChatActionsContext';

const ALLOW_MESSAGE = 'Proceed with the plan above.';
const DEFAULT_DENY_MESSAGE = 'Please revise the plan.';

interface InteractionItemProps {
  interaction: InteractionMessage;
}

// ============================================
// Form Field Renderers
// ============================================

function TextField({ field, value, onChange }: { field: InteractionPromptField; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className="w-full px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

function TextareaField({ field, value, onChange }: { field: InteractionPromptField; value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      rows={3}
      className="w-full px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
    />
  );
}

function ChoiceField({
  field,
  value,
  customEnabled,
  customValue,
  onChange,
  onCustomEnabledChange,
  onCustomValueChange,
}: {
  field: InteractionPromptField;
  value: string | string[];
  customEnabled: boolean;
  customValue: string;
  onChange: (v: string | string[]) => void;
  onCustomEnabledChange: (v: boolean) => void;
  onCustomValueChange: (v: string) => void;
}) {
  const selected = Array.isArray(value) ? value : (value ? [value] : []);
  const isMulti = field.type === 'multiselect';

  const toggle = (optValue: string) => {
    if (isMulti) {
      const next = selected.includes(optValue)
        ? selected.filter((item) => item !== optValue)
        : [...selected, optValue];
      onChange(next);
      return;
    }
    onChange(optValue);
    onCustomEnabledChange(false);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {(field.options || []).map((opt) => {
        const isSelected = selected.includes(opt.value);
        return (
          <label
            key={opt.value}
            className={`flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors text-xs ${
              isSelected
                ? 'bg-primary/10 border border-primary/30'
                : 'bg-muted/50 border border-transparent hover:bg-muted'
            }`}
          >
            <input
              type={isMulti ? 'checkbox' : 'radio'}
              name={field.id}
              checked={isSelected}
              onChange={() => toggle(opt.value)}
              className="mt-0.5 w-3.5 h-3.5 flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">{opt.label}</div>
              {opt.description && (
                <div className="text-muted-foreground mt-0.5">{opt.description}</div>
              )}
            </div>
          </label>
        );
      })}

      {field.allowCustomValue && (
        <label
          className={`flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors text-xs ${
            customEnabled
              ? 'bg-primary/10 border border-primary/30'
              : 'bg-muted/50 border border-transparent hover:bg-muted'
          }`}
        >
          <input
            type={isMulti ? 'checkbox' : 'radio'}
            name={field.id}
            checked={customEnabled}
            onChange={() => {
              const next = !customEnabled;
              onCustomEnabledChange(next);
              if (!isMulti && next) onChange('');
            }}
            className="mt-0.5 w-3.5 h-3.5 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">{field.customValuePlaceholder || 'Other'}</div>
            {customEnabled && (
              <input
                type="text"
                value={customValue}
                onChange={(e) => onCustomValueChange(e.target.value)}
                placeholder={field.placeholder || 'Type your answer...'}
                className="mt-1 w-full px-2 py-1 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
          </div>
        </label>
      )}
    </div>
  );
}

function ConfirmField({ value, onChange }: { field: InteractionPromptField; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-8 h-4 rounded-full transition-colors relative ${value ? 'bg-primary' : 'bg-muted-foreground/30'}`}
    >
      <span className={`block w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ============================================
// Prompt Interaction Renderer
// ============================================

function buildPromptResponse(
  fields: InteractionPromptField[],
  formData: Record<string, unknown>,
  customValues: Record<string, string>,
  customEnabled: Record<string, boolean>,
): Record<string, unknown> {
  const response: Record<string, unknown> = {};
  for (const field of fields) {
    const value = formData[field.id];
    const customValue = customValues[field.id]?.trim();
    const usingCustom = customEnabled[field.id] && customValue;

    if (field.type === 'multiselect') {
      const selected = Array.isArray(value) ? [...value] : [];
      if (usingCustom) selected.push(customValue);
      response[field.id] = selected;
      continue;
    }

    if (field.type === 'confirm') {
      response[field.id] = Boolean(value);
      continue;
    }

    response[field.id] = usingCustom ? customValue : String(value ?? '');
  }
  return response;
}

function formatAskUserAnswer(
  fields: InteractionPromptField[],
  formData: Record<string, unknown>,
  customValues: Record<string, string>,
  customEnabled: Record<string, boolean>,
): string {
  return fields.map((field) => {
    const raw = buildPromptResponse([field], formData, customValues, customEnabled)[field.id];
    const answerText = Array.isArray(raw)
      ? (raw.length > 0 ? raw.join(', ') : 'No answer')
      : String(raw || 'No answer');
    return `Q: ${field.label}\nA: ${answerText}`;
  }).join('\n\n');
}

function PromptRenderer({ interaction }: { interaction: InteractionPromptMessage }) {
  const { sendMessage, handlePromptAnswer } = useConnection();
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const field of interaction.fields) {
      if (field.type === 'multiselect') init[field.id] = [];
      else if (field.type === 'confirm') init[field.id] = field.defaultValue === 'true';
      else init[field.id] = field.defaultValue || '';
    }
    return init;
  });
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [customEnabled, setCustomEnabled] = useState<Record<string, boolean>>({});

  const handleSubmit = useCallback(() => {
    const response = buildPromptResponse(interaction.fields, formData, customValues, customEnabled);
    if (interaction.responseMode === 'prompt_answer') {
      handlePromptAnswer(
        interaction.interactionId,
        formatAskUserAnswer(interaction.fields, formData, customValues, customEnabled),
      );
    } else {
      sendMessage({
        type: 'interaction_response',
        interactionId: interaction.interactionId,
        sessionId: interaction.sessionId,
        response,
      });
    }
    setSubmitted(true);
  }, [sendMessage, handlePromptAnswer, interaction, formData, customValues, customEnabled]);

  const handleCancel = useCallback(() => {
    if (interaction.responseMode === 'prompt_answer') {
      handlePromptAnswer(interaction.interactionId, 'User declined to answer.');
      setSubmitted(true);
    }
  }, [handlePromptAnswer, interaction]);

  if (submitted) {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 rounded-md bg-success/10 border border-success/30">
        <div className="flex items-center gap-2 text-xs font-medium text-success">
          <Check size={12} />
          <span>{interaction.variant === 'question' ? 'Response submitted' : 'Form submitted'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/30">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <FileQuestion size={12} className="text-primary" />
        <span>{interaction.title}</span>
      </div>
      {interaction.description && (
        <p className="text-xs text-muted-foreground">{interaction.description}</p>
      )}
      <div className="flex flex-col gap-2">
        {interaction.fields.map((field) => (
          <div key={field.id} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-foreground">
              {field.label}
              {field.required && <span className="text-destructive ml-0.5">*</span>}
            </label>
            {field.description && (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            )}
            {field.type === 'text' && (
              <TextField field={field} value={formData[field.id] as string} onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))} />
            )}
            {field.type === 'textarea' && (
              <TextareaField field={field} value={formData[field.id] as string} onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))} />
            )}
            {(field.type === 'select' || field.type === 'multiselect') && (
              <ChoiceField
                field={field}
                value={formData[field.id] as string | string[]}
                customEnabled={Boolean(customEnabled[field.id])}
                customValue={customValues[field.id] || ''}
                onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))}
                onCustomEnabledChange={(v) => setCustomEnabled(prev => ({ ...prev, [field.id]: v }))}
                onCustomValueChange={(v) => setCustomValues(prev => ({ ...prev, [field.id]: v }))}
              />
            )}
            {field.type === 'confirm' && (
              <ConfirmField field={field} value={formData[field.id] as boolean} onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))} />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 self-end">
        {interaction.responseMode === 'prompt_answer' && (
          <button
            onClick={handleCancel}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
          >
            {interaction.cancelLabel || 'Skip'}
          </button>
        )}
        <button
          onClick={handleSubmit}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Send size={10} />
          {interaction.submitLabel || 'Submit'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Approval Interaction Renderer
// ============================================

function ApprovalRenderer({ interaction }: { interaction: ApprovalInteractionMessage }) {
  const { sendMessage } = useConnection();
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);

  const handleDecision = useCallback((approved: boolean) => {
    sendMessage({
      type: 'interaction_response',
      interactionId: interaction.interactionId,
      sessionId: interaction.sessionId,
      response: { approved },
    });
    setDecision(approved ? 'approved' : 'rejected');
  }, [sendMessage, interaction.interactionId, interaction.sessionId]);

  if (decision) {
    return (
      <div className={`flex flex-col gap-1 px-3 py-2 rounded-md border ${decision === 'approved' ? 'bg-success/10 border-success/30' : 'bg-destructive/10 border-destructive/30'}`}>
        <div className={`flex items-center gap-2 text-xs font-medium ${decision === 'approved' ? 'text-success' : 'text-destructive'}`}>
          {decision === 'approved' ? <ThumbsUp size={12} /> : <ThumbsDown size={12} />}
          <span>{interaction.title} — {decision === 'approved' ? 'Approved' : 'Rejected'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2 rounded-md bg-warning/5 border border-warning/30">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <ShieldAlert size={12} className="text-warning" />
        <span>{interaction.title}</span>
      </div>
      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{interaction.message}</p>
      <div className="flex items-center gap-2 self-end">
        <button
          onClick={() => handleDecision(false)}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
        >
          <ThumbsDown size={10} />
          {interaction.rejectLabel || 'Reject'}
        </button>
        <button
          onClick={() => handleDecision(true)}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <ThumbsUp size={10} />
          {interaction.approveLabel || 'Approve'}
        </button>
      </div>
    </div>
  );
}

// ============================================
// Plan Review Interaction Renderer
// ============================================

function PlanReviewRenderer({ interaction }: { interaction: PlanReviewInteractionMessage }) {
  const { sendMessage } = useConnection();
  const createIssue = useLocalIssueStore((s) => s.createIssue);
  const [decision, setDecision] = useState<
    | { kind: 'approved' }
    | { kind: 'rejected' }
    | { kind: 'saved'; issueId: string }
    | null
  >(null);
  const [feedback, setFeedback] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAllTodos, setShowAllTodos] = useState(false);

  const chatActions = useChatActionsOptional();
  const isClientSynth = interaction.source === 'client_synth';

  const handleApprove = useCallback(async () => {
    if (isClientSynth && chatActions && interaction.sessionId) {
      const trimmed = feedback.trim();
      const text = trimmed ? `${ALLOW_MESSAGE}\n\n${trimmed}` : ALLOW_MESSAGE;
      chatActions.setMode(interaction.sessionId, 'default');
      setDecision({ kind: 'approved' });
      try {
        await chatActions.handleSendMessage(text, undefined, 'default');
      } catch (err) {
        setDecision(null);
        chatActions.setMode(interaction.sessionId, 'plan');
        console.error('[PlanReviewRenderer] Approve send failed', err);
      }
      return;
    }
    sendMessage({
      type: 'interaction_response',
      interactionId: interaction.interactionId,
      sessionId: interaction.sessionId,
      response: { approved: true, feedback: feedback.trim() || undefined },
    });
    setDecision({ kind: 'approved' });
  }, [isClientSynth, chatActions, interaction, feedback, sendMessage]);

  const handleDeny = useCallback(async () => {
    if (isClientSynth && chatActions && interaction.sessionId) {
      const text = feedback.trim() || DEFAULT_DENY_MESSAGE;
      setDecision({ kind: 'rejected' });
      try {
        await chatActions.handleSendMessage(text);
      } catch (err) {
        setDecision(null);
        console.error('[PlanReviewRenderer] Deny send failed', err);
      }
      return;
    }
    sendMessage({
      type: 'interaction_response',
      interactionId: interaction.interactionId,
      sessionId: interaction.sessionId,
      response: { approved: false, feedback: feedback.trim() || undefined },
    });
    setDecision({ kind: 'rejected' });
  }, [isClientSynth, chatActions, interaction, feedback, sendMessage]);

  const handleSaveAsIssue = useCallback(
    async (title: string) => {
      setSaving(true);
      setSaveError(null);
      // NOTE: createIssue runs before handleSendMessage / sendMessage. A failed
      // message send (especially in the client_synth branch) leaves an orphaned
      // issue in the local store. Users can re-trigger Save as Issue and a new
      // issue will be created — acceptable for v1 since send failures are rare
      // and local issues are cheap to clean up.
      try {
        const projectId = useProjectStore
          .getState()
          .sessions.find((s) => s.id === interaction.sessionId)?.projectId;
        if (!projectId) {
          throw new Error('Could not resolve project for this session');
        }
        const issue = await createIssue(projectId, {
          title,
          description: interaction.plan,
          labels: [ACTIONABLE_LABEL],
        });
        const savedMessage = `Saved as issue #${issue.id} for later.`;
        if (isClientSynth && chatActions) {
          await chatActions.handleSendMessage(savedMessage);
        } else {
          sendMessage({
            type: 'interaction_response',
            interactionId: interaction.interactionId,
            sessionId: interaction.sessionId,
            response: { approved: false, feedback: savedMessage },
          });
        }
        setDecision({ kind: 'saved', issueId: issue.id });
        setDialogOpen(false);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save');
      } finally {
        setSaving(false);
      }
    },
    [isClientSynth, chatActions, createIssue, sendMessage, interaction.sessionId, interaction.interactionId, interaction.plan],
  );

  if (decision) {
    const isApproved = decision.kind === 'approved';
    const isSaved = decision.kind === 'saved';
    const tone = isApproved
      ? 'bg-success/10 border-success/30 text-success'
      : isSaved
        ? 'bg-primary/10 border-primary/30 text-primary'
        : 'bg-destructive/10 border-destructive/30 text-destructive';
    return (
      <div className={`flex flex-col gap-1 px-3 py-2 rounded-md border ${tone}`}>
        <div className="flex items-center gap-2 text-xs font-medium">
          {isApproved ? (
            <ThumbsUp size={12} />
          ) : isSaved ? (
            <Bookmark size={12} />
          ) : (
            <ThumbsDown size={12} />
          )}
          <span>
            {isApproved
              ? 'Plan Approved'
              : isSaved
                ? `Saved as issue #${decision.issueId}`
                : 'Plan Rejected'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
          <ClipboardCheck size={12} className="text-primary" />
          <span>Plan Review</span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-0.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>

      <div
        className={`text-xs text-foreground whitespace-pre-wrap overflow-auto rounded-md bg-muted/30 p-2 ${
          expanded ? 'max-h-[80vh]' : 'max-h-60'
        }`}
      >
        {interaction.plan}
      </div>

      {interaction.allowedPrompts && interaction.allowedPrompts.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Requested permissions:</span>
          <ul className="text-xs text-foreground list-disc list-inside space-y-0.5">
            {interaction.allowedPrompts.map((p, i) => (
              <li key={i}>
                <code className="text-primary">{p.tool}</code> — {p.prompt}
              </li>
            ))}
          </ul>
        </div>
      )}

      {interaction.todos && interaction.todos.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-[11px] font-medium text-muted-foreground">Steps</span>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {(showAllTodos ? interaction.todos : interaction.todos.slice(0, 8)).map((todo, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                <span className="flex-shrink-0 mt-0.5">
                  {todo.status === 'completed' ? (
                    <CheckCircle2 size={12} className="text-success" />
                  ) : todo.status === 'in_progress' ? (
                    <Loader2 size={12} className="animate-spin text-primary" />
                  ) : todo.status === 'cancelled' ? (
                    <Square size={12} className="text-muted-foreground/60" />
                  ) : (
                    <Square size={12} className="text-muted-foreground" />
                  )}
                </span>
                <span
                  className={
                    todo.status === 'completed' ? 'text-muted-foreground line-through' :
                    todo.status === 'cancelled' ? 'text-muted-foreground/70 line-through' :
                    'text-foreground'
                  }
                >
                  {todo.content}
                </span>
              </div>
            ))}
          </div>
          {interaction.todos.length > 8 && (
            <button
              onClick={() => setShowAllTodos((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground text-left transition-colors"
            >
              {showAllTodos ? 'Show fewer steps' : `Show all ${interaction.todos.length} steps`}
            </button>
          )}
        </div>
      )}

      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Add an optional comment for approval or rejection"
        rows={2}
        className="w-full px-2 py-1 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
      />

      {saveError && <div className="text-xs text-destructive">{saveError}</div>}

      <div className="flex items-center gap-2 self-end">
        <button
          onClick={() => setDialogOpen(true)}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Bookmark size={10} />
          Save as Issue
        </button>
        <button
          onClick={handleDeny}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ThumbsDown size={10} />
          Deny
        </button>
        <button
          onClick={handleApprove}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ThumbsUp size={10} />
          Approve Plan
        </button>
      </div>

      {dialogOpen && (
        <SavePlanAsIssueDialog
          defaultTitle={extractDefaultTitleFromPlan(interaction.plan)}
          submitting={saving}
          onSave={handleSaveAsIssue}
          onCancel={() => {
            setDialogOpen(false);
            setSaveError(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================
// Main InteractionItem
// ============================================

function InteractionItemInner({ interaction }: InteractionItemProps) {
  if (interaction.type === 'interaction_todo_update') {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 rounded-md bg-muted/30 border border-border/50">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <ListTodo size={12} />
          <span>Task List</span>
        </div>
        <div className="space-y-1">
          {interaction.todos.map((todo, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="flex-shrink-0">
                {todo.status === 'completed' ? (
                  <CheckCircle2 size={12} className="text-success" />
                ) : todo.status === 'in_progress' ? (
                  <Loader2 size={12} className="animate-spin text-primary" />
                ) : (
                  <Square size={12} className="text-muted-foreground" />
                )}
              </span>
              <span className={todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (interaction.type === 'interaction_prompt') {
    return <PromptRenderer interaction={interaction} />;
  }

  if (interaction.type === 'interaction_approval') {
    return <ApprovalRenderer interaction={interaction} />;
  }

  if (interaction.type === 'interaction_plan_review') {
    return <PlanReviewRenderer interaction={interaction} />;
  }

  return null;
}

export const InteractionItem = memo(InteractionItemInner);
