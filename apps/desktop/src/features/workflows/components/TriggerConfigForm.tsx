import { Plus, X, Clock, Timer, Zap, MousePointer, CalendarClock } from 'lucide-react';
import type { WorkflowTrigger, WorkflowTriggerType } from '@my-claudia/shared';
import { useState, useEffect } from 'react';
import { useWorkflowStore } from '../store';

interface TriggerConfigFormProps {
  triggers: WorkflowTrigger[];
  onChange: (triggers: WorkflowTrigger[]) => void;
}

const TRIGGER_ICONS: Record<WorkflowTriggerType, React.ReactNode> = {
  manual: <MousePointer size={12} />,
  cron: <Clock size={12} />,
  interval: <Timer size={12} />,
  once: <CalendarClock size={12} />,
  event: <Zap size={12} />,
};

const TRIGGER_LABELS: Record<WorkflowTriggerType, string> = {
  manual: 'Manual',
  cron: 'Cron Schedule',
  interval: 'Interval',
  once: 'One-time',
  event: 'Event',
};

// Fallback while trigger sources are loading
const FALLBACK_EVENTS = ['run.completed', 'run.error', 'run.started', 'plugin.activated'];

const CRON_PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily 9AM', cron: '0 9 * * *' },
  { label: 'Daily noon', cron: '0 12 * * *' },
  { label: 'Weekdays 9AM', cron: '0 9 * * 1-5' },
  { label: 'Weekly Sunday', cron: '0 2 * * 0' },
];

function formatDateTimeLocal(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

const CUSTOM_VALUE = '__custom__';

function EventTriggerInput({ value, availableEvents, onChange }: {
  value: string;
  availableEvents: { value: string; label: string; category?: string }[];
  onChange: (v: string) => void;
}) {
  const isPreset = availableEvents.some((e) => e.value === value);
  const isCustom = !isPreset && value !== '';
  const selectValue = isCustom ? CUSTOM_VALUE : value;

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === CUSTOM_VALUE) {
      onChange('');
    } else {
      onChange(e.target.value);
    }
  };

  return (
    <div className="space-y-1">
      <select
        value={selectValue}
        onChange={handleSelectChange}
        className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
      >
        <option value="">Select event...</option>
        {availableEvents.map((evt) => (
          <option key={evt.value} value={evt.value}>{evt.label}</option>
        ))}
        <option value={CUSTOM_VALUE}>Custom pattern...</option>
      </select>
      {(isCustom || selectValue === CUSTOM_VALUE) && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. run.* or my-plugin.event"
          autoFocus
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:border-primary font-mono"
        />
      )}
    </div>
  );
}

function TriggerCard({ trigger, onUpdate, onRemove, availableEvents }: {
  trigger: WorkflowTrigger;
  onUpdate: (t: WorkflowTrigger) => void;
  onRemove: () => void;
  availableEvents: { value: string; label: string; category?: string }[];
}) {
  return (
    <div className="border border-border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {TRIGGER_ICONS[trigger.type]}
          {TRIGGER_LABELS[trigger.type]}
        </div>
        <button
          onClick={onRemove}
          className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-destructive"
        >
          <X size={14} />
        </button>
      </div>

      {trigger.type === 'cron' && (
        <div className="space-y-1">
          <input
            type="text"
            value={trigger.cron ?? ''}
            onChange={(e) => onUpdate({ ...trigger, cron: e.target.value })}
            placeholder="0 9 * * *"
            className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:border-primary font-mono"
          />
          <div className="flex flex-wrap gap-1">
            {CRON_PRESETS.map((preset) => (
              <button
                key={preset.cron}
                onClick={() => onUpdate({ ...trigger, cron: preset.cron })}
                className="px-1.5 py-0.5 text-xs rounded border border-border hover:bg-secondary transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {trigger.type === 'interval' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Every</span>
          <input
            type="number"
            min={1}
            value={trigger.intervalMinutes ?? 30}
            onChange={(e) => onUpdate({ ...trigger, intervalMinutes: parseInt(e.target.value) || 30 })}
            className="w-20 px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
          />
          <span className="text-xs text-muted-foreground">minutes</span>
        </div>
      )}

      {trigger.type === 'once' && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Run at</span>
          <input
            type="datetime-local"
            value={formatDateTimeLocal(trigger.onceAt)}
            onChange={(e) => onUpdate({ ...trigger, onceAt: e.target.value ? new Date(e.target.value).getTime() : undefined })}
            className="flex-1 px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
          />
        </div>
      )}

      {trigger.type === 'event' && (
        <EventTriggerInput
          value={trigger.event ?? ''}
          availableEvents={availableEvents}
          onChange={(event) => onUpdate({ ...trigger, event })}
        />
      )}
    </div>
  );
}

export function TriggerConfigForm({ triggers, onChange }: TriggerConfigFormProps) {
  const [showAdd, setShowAdd] = useState(false);
  const { triggerSources, loadTriggerSources } = useWorkflowStore();

  useEffect(() => {
    if (triggerSources.length === 0) {
      loadTriggerSources();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const availableEvents = triggerSources.length > 0
    ? triggerSources.map((src) => ({ value: src.eventPattern, label: `${src.name} (${src.eventPattern})`, category: src.category }))
    : FALLBACK_EVENTS.map((e) => ({ value: e, label: e }));

  const addTrigger = (type: WorkflowTriggerType) => {
    const newTrigger: WorkflowTrigger = { type };
    if (type === 'cron') newTrigger.cron = '0 9 * * *';
    if (type === 'interval') newTrigger.intervalMinutes = 30;
    if (type === 'once') newTrigger.onceAt = Date.now() + 60 * 60 * 1000;
    if (type === 'event') newTrigger.event = availableEvents[0]?.value ?? 'run.completed';
    onChange([...triggers, newTrigger]);
    setShowAdd(false);
  };

  const updateTrigger = (index: number, trigger: WorkflowTrigger) => {
    const updated = [...triggers];
    updated[index] = trigger;
    onChange(updated);
  };

  const removeTrigger = (index: number) => {
    onChange(triggers.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Triggers</h4>
      </div>

      {triggers.map((trigger, i) => (
        <TriggerCard
          key={i}
          trigger={trigger}
          onUpdate={(t) => updateTrigger(i, t)}
          onRemove={() => removeTrigger(i)}
          availableEvents={availableEvents}
        />
      ))}

      {showAdd ? (
        <div className="border border-dashed border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-2">Select trigger type</div>
          <div className="flex flex-wrap gap-1.5">
            {(['cron', 'interval', 'once', 'event', 'manual'] as WorkflowTriggerType[]).map((type) => (
              <button
                key={type}
                onClick={() => addTrigger(type)}
                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-border hover:bg-secondary transition-colors"
              >
                {TRIGGER_ICONS[type]}
                {TRIGGER_LABELS[type]}
              </button>
            ))}
            <button
              onClick={() => setShowAdd(false)}
              className="px-2.5 py-1 text-xs rounded-md text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 w-full justify-center py-2 text-xs rounded-lg border border-dashed border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus size={14} />
          Add Trigger
        </button>
      )}
    </div>
  );
}
