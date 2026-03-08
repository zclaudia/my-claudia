import { useState } from 'react';
import { X } from 'lucide-react';
import type { ScheduleType, ScheduledActionType } from '@my-claudia/shared';
import { useScheduledTaskStore } from '../../stores/scheduledTaskStore';

interface Props {
  projectId: string;
  onClose: () => void;
}

const SCHEDULE_TYPES: { value: ScheduleType; label: string }[] = [
  { value: 'cron', label: 'Cron' },
  { value: 'interval', label: 'Interval' },
  { value: 'once', label: 'Once' },
];

const ACTION_TYPES: { value: ScheduledActionType; label: string; description: string }[] = [
  { value: 'prompt', label: 'AI Prompt', description: 'Send a prompt to AI' },
  { value: 'shell', label: 'Shell', description: 'Execute a shell command' },
  { value: 'command', label: 'Command', description: 'Run a plugin command' },
  { value: 'webhook', label: 'Webhook', description: 'HTTP request' },
  { value: 'plugin_event', label: 'Plugin Event', description: 'Emit an event' },
];

export function CreateScheduledTaskDialog({ projectId, onClose }: Props) {
  const create = useScheduledTaskStore((s) => s.create);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('interval');
  const [cron, setCron] = useState('0 9 * * *');
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [actionType, setActionType] = useState<ScheduledActionType>('prompt');
  const [prompt, setPrompt] = useState('');
  const [shellCmd, setShellCmd] = useState('');
  const [command, setCommand] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [pluginEvent, setPluginEvent] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      let actionConfig: any = {};
      switch (actionType) {
        case 'prompt':
          actionConfig = { prompt, sessionName: `Scheduled: ${name}` };
          break;
        case 'shell':
          actionConfig = { command: shellCmd };
          break;
        case 'command':
          actionConfig = { command };
          break;
        case 'webhook':
          actionConfig = { url: webhookUrl, method: 'POST' };
          break;
        case 'plugin_event':
          actionConfig = { event: pluginEvent };
          break;
      }

      await create(projectId, {
        name: name.trim(),
        description: description.trim() || undefined,
        scheduleType,
        scheduleCron: scheduleType === 'cron' ? cron : undefined,
        scheduleIntervalMinutes: scheduleType === 'interval' ? intervalMinutes : undefined,
        actionType,
        actionConfig,
      });
      onClose();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-2.5 py-1.5 text-xs rounded-md border border-input bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-popover border border-border rounded-xl shadow-xl w-[440px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium text-foreground">New Scheduled Task</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary text-muted-foreground">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <input
              className={inputClass}
              placeholder="e.g., Daily Code Review"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
            <input
              className={inputClass}
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Schedule type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Schedule</label>
            <div className="flex gap-1.5 mb-2">
              {SCHEDULE_TYPES.map((st) => (
                <button
                  key={st.value}
                  onClick={() => setScheduleType(st.value)}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    scheduleType === st.value
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-input text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {scheduleType === 'cron' && (
              <input
                className={inputClass}
                placeholder="e.g., 0 9 * * * (minute hour day month weekday)"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
              />
            )}
            {scheduleType === 'interval' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  className={`${inputClass} w-20`}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value) || 1)}
                />
                <span className="text-xs text-muted-foreground">minutes</span>
              </div>
            )}
          </div>

          {/* Action type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Action</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {ACTION_TYPES.map((at) => (
                <button
                  key={at.value}
                  onClick={() => setActionType(at.value)}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    actionType === at.value
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-input text-muted-foreground hover:text-foreground'
                  }`}
                  title={at.description}
                >
                  {at.label}
                </button>
              ))}
            </div>

            {/* Action config */}
            {actionType === 'prompt' && (
              <textarea
                className={`${inputClass} h-24 resize-none`}
                placeholder="Enter the prompt to send to AI..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            )}
            {actionType === 'shell' && (
              <input
                className={inputClass}
                placeholder="e.g., npm run lint"
                value={shellCmd}
                onChange={(e) => setShellCmd(e.target.value)}
              />
            )}
            {actionType === 'command' && (
              <input
                className={inputClass}
                placeholder="e.g., /echo:stats"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
            )}
            {actionType === 'webhook' && (
              <input
                className={inputClass}
                placeholder="https://..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
            )}
            {actionType === 'plugin_event' && (
              <input
                className={inputClass}
                placeholder="e.g., my-plugin.custom-event"
                value={pluginEvent}
                onChange={(e) => setPluginEvent(e.target.value)}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border border-input text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || saving}
            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
