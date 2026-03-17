import { memo, useState, useCallback } from 'react';
import { CheckCircle2, Loader2, Square, ListTodo, MessageCircleQuestion, FileQuestion, Send, Check, ShieldAlert, ThumbsUp, ThumbsDown } from 'lucide-react';
import type { InteractionMessage, AskUserFormInteractionMessage, AskUserFormField, ApprovalInteractionMessage } from '@my-claudia/shared';
import { useConnection } from '../../contexts/ConnectionContext';

interface InteractionItemProps {
  interaction: InteractionMessage;
}

// ============================================
// Form Field Renderers
// ============================================

function TextField({ field, value, onChange }: { field: AskUserFormField; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

function TextareaField({ field, value, onChange }: { field: AskUserFormField; value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      rows={3}
      className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
    />
  );
}

function SelectField({ field, value, onChange }: { field: AskUserFormField; value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    >
      <option value="">{field.placeholder || 'Select...'}</option>
      {(field.options || []).map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function MultiselectField({ field, value, onChange }: { field: AskUserFormField; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (optValue: string) => {
    onChange(value.includes(optValue) ? value.filter(v => v !== optValue) : [...value, optValue]);
  };
  return (
    <div className="flex flex-col gap-1">
      {(field.options || []).map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            className="rounded border-border"
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

function ConfirmField({ value, onChange }: { field: AskUserFormField; value: boolean; onChange: (v: boolean) => void }) {
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
// Form Interaction Renderer
// ============================================

function AskUserFormRenderer({ interaction }: { interaction: AskUserFormInteractionMessage }) {
  const { sendMessage } = useConnection();
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

  const handleSubmit = useCallback(() => {
    sendMessage({
      type: 'interaction_response',
      interactionId: interaction.interactionId,
      sessionId: interaction.sessionId,
      response: formData,
    });
    setSubmitted(true);
  }, [sendMessage, interaction.interactionId, interaction.sessionId, formData]);

  if (submitted) {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 rounded-md bg-success/10 border border-success/30">
        <div className="flex items-center gap-2 text-xs font-medium text-success">
          <Check size={12} />
          <span>Form submitted</span>
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
            {field.type === 'text' && (
              <TextField field={field} value={formData[field.id] as string} onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))} />
            )}
            {field.type === 'textarea' && (
              <TextareaField field={field} value={formData[field.id] as string} onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))} />
            )}
            {field.type === 'select' && (
              <SelectField field={field} value={formData[field.id] as string} onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))} />
            )}
            {field.type === 'multiselect' && (
              <MultiselectField field={field} value={formData[field.id] as string[]} onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))} />
            )}
            {field.type === 'confirm' && (
              <ConfirmField field={field} value={formData[field.id] as boolean} onChange={(v) => setFormData(prev => ({ ...prev, [field.id]: v }))} />
            )}
          </div>
        ))}
      </div>
      <button
        onClick={handleSubmit}
        className="self-end flex items-center gap-1 px-3 py-1 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Send size={10} />
        Submit
      </button>
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
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded border border-border bg-background text-foreground hover:bg-muted transition-colors"
        >
          <ThumbsDown size={10} />
          {interaction.rejectLabel || 'Reject'}
        </button>
        <button
          onClick={() => handleDecision(true)}
          className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <ThumbsUp size={10} />
          {interaction.approveLabel || 'Approve'}
        </button>
      </div>
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

  if (interaction.type === 'interaction_ask_user') {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 rounded-md bg-muted/30 border border-border/50">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <MessageCircleQuestion size={12} />
          <span>Question</span>
        </div>
        <div className="space-y-1">
          {interaction.questions.map((q, idx) => (
            <div key={idx} className="text-xs text-foreground">
              {q.question}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (interaction.type === 'interaction_ask_user_form') {
    return <AskUserFormRenderer interaction={interaction} />;
  }

  if (interaction.type === 'interaction_approval') {
    return <ApprovalRenderer interaction={interaction} />;
  }

  return null;
}

export const InteractionItem = memo(InteractionItemInner);
