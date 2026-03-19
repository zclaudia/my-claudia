import { Plus, X, Clock, Timer, Zap, MousePointer } from 'lucide-react';
import type { WorkflowTrigger, WorkflowTriggerType } from '@my-claudia/shared';
import { useState } from 'react';

interface TriggerConfigFormProps {
  triggers: WorkflowTrigger[];
  onChange: (triggers: WorkflowTrigger[]) => void;
}

const TRIGGER_ICONS: Record<WorkflowTriggerType, React.ReactNode> = {
  manual: <MousePointer size={12} />,
  cron: <Clock size={12} />,
  interval: <Timer size={12} />,
  event: <Zap size={12} />,
};

const TRIGGER_LABELS: Record<WorkflowTriggerType, string> = {
  manual: 'Manual',
  cron: 'Cron Schedule',
  interval: 'Interval',
  event: 'Event',
};

const KNOWN_EVENTS = ['run.completed', 'run.failed', 'plugin.activated'];

const CRON_PRESETS = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily 9AM', cron: '0 9 * * *' },
  { label: 'Daily noon', cron: '0 12 * * *' },
  { label: 'Weekdays 9AM', cron: '0 9 * * 1-5' },
  { label: 'Weekly Sunday', cron: '0 2 * * 0' },
];

function TriggerCard({ trigger, onUpdate, onRemove }: {
  trigger: WorkflowTrigger;
  onUpdate: (t: WorkflowTrigger) => void;
  onRemove: () => void;
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

      {trigger.type === 'event' && (
        <select
          value={trigger.event ?? ''}
          onChange={(e) => onUpdate({ ...trigger, event: e.target.value })}
          className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background"
        >
          <option value="">Select event...</option>
          {KNOWN_EVENTS.map((evt) => (
            <option key={evt} value={evt}>{evt}</option>
          ))}
        </select>
      )}
    </div>
  );
}

export function TriggerConfigForm({ triggers, onChange }: TriggerConfigFormProps) {
  const [showAdd, setShowAdd] = useState(false);

  const addTrigger = (type: WorkflowTriggerType) => {
    const newTrigger: WorkflowTrigger = { type };
    if (type === 'cron') newTrigger.cron = '0 9 * * *';
    if (type === 'interval') newTrigger.intervalMinutes = 30;
    if (type === 'event') newTrigger.event = 'run.completed';
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
        />
      ))}

      {showAdd ? (
        <div className="border border-dashed border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground mb-2">Select trigger type</div>
          <div className="flex flex-wrap gap-1.5">
            {(['cron', 'interval', 'event', 'manual'] as WorkflowTriggerType[]).map((type) => (
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
