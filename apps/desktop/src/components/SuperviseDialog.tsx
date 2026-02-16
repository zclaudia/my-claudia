import { useState, useCallback } from 'react';
import * as api from '../services/api';
import { useSupervisionStore } from '../stores/supervisionStore';

interface SuperviseDialogProps {
  sessionId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SuperviseDialog({ sessionId, isOpen, onClose }: SuperviseDialogProps) {
  const [goal, setGoal] = useState('');
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [maxIterations, setMaxIterations] = useState<number | ''>('');
  const [cooldownSeconds, setCooldownSeconds] = useState(5);
  const [showSettings, setShowSettings] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setGoal('');
    setSubtasks([]);
    setNewSubtask('');
    setMaxIterations('');
    setCooldownSeconds(5);
    setShowSettings(false);
    setPlanning(false);
    setCreating(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const handleLetAIPlan = useCallback(async () => {
    if (!sessionId) return;
    setPlanning(true);
    setError(null);
    try {
      const result = await api.planSupervision({ sessionId, hint: goal || undefined });
      setGoal(result.goal);
      if (result.subtasks.length > 0) {
        setSubtasks(result.subtasks);
      }
      if (result.estimatedIterations) {
        setMaxIterations(result.estimatedIterations);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get AI plan');
    } finally {
      setPlanning(false);
    }
  }, [sessionId, goal]);

  const handleAddSubtask = useCallback(() => {
    const trimmed = newSubtask.trim();
    if (!trimmed) return;
    setSubtasks(prev => [...prev, trimmed]);
    setNewSubtask('');
  }, [newSubtask]);

  const handleRemoveSubtask = useCallback((index: number) => {
    setSubtasks(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleStart = useCallback(async () => {
    if (!sessionId || !goal.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const supervision = await api.createSupervision({
        sessionId,
        goal: goal.trim(),
        subtasks: subtasks.length > 0 ? subtasks : undefined,
        maxIterations: maxIterations || undefined,
        cooldownSeconds,
      });
      useSupervisionStore.getState().updateSupervision(supervision);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create supervision');
      setCreating(false);
    }
  }, [sessionId, goal, subtasks, maxIterations, cooldownSeconds, handleClose]);

  if (!isOpen || !sessionId) return null;

  const defaultMaxIter = subtasks.length > 0 ? subtasks.length * 3 : 5;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={handleClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-base font-semibold">Supervise Session</h2>
            <button
              onClick={handleClose}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="px-4 py-3 space-y-3 max-h-[60vh] overflow-y-auto">
            {/* Goal */}
            <div>
              <label className="block text-sm font-medium mb-1">Goal</label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Describe what this session should achieve..."
                rows={3}
                className="w-full px-3 py-2 bg-secondary border border-border rounded text-sm resize-none focus:outline-none focus:border-primary"
              />
              <div className="flex justify-end mt-1">
                <button
                  onClick={handleLetAIPlan}
                  disabled={planning}
                  className="text-xs text-primary hover:text-primary/80 disabled:opacity-50"
                >
                  {planning ? 'Planning...' : 'Let AI Plan'}
                </button>
              </div>
            </div>

            {/* Subtasks */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Subtasks <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              {subtasks.length > 0 && (
                <ul className="space-y-1 mb-2">
                  {subtasks.map((task, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground text-xs w-5 text-right flex-shrink-0">{i + 1}.</span>
                      <span className="flex-1 truncate">{task}</span>
                      <button
                        onClick={() => handleRemoveSubtask(i)}
                        className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-destructive flex-shrink-0"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSubtask();
                    }
                  }}
                  placeholder="Add a subtask..."
                  className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                />
                <button
                  onClick={handleAddSubtask}
                  disabled={!newSubtask.trim()}
                  className="px-2 py-1 text-xs bg-secondary border border-border rounded hover:bg-secondary/80 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Settings (collapsible) */}
            <div>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <svg
                  className={`w-3.5 h-3.5 transition-transform ${showSettings ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Settings
                <span className="text-xs text-muted-foreground ml-1">
                  (max {typeof maxIterations === 'number' ? maxIterations : defaultMaxIter} iter, {cooldownSeconds}s cooldown)
                </span>
              </button>
              {showSettings && (
                <div className="mt-2 pl-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm w-28">Max iterations</label>
                    <input
                      type="number"
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(e.target.value ? parseInt(e.target.value) : '')}
                      placeholder={String(defaultMaxIter)}
                      min={1}
                      max={100}
                      className="w-20 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm w-28">Cooldown (sec)</label>
                    <input
                      type="number"
                      value={cooldownSeconds}
                      onChange={(e) => setCooldownSeconds(parseInt(e.target.value) || 5)}
                      min={1}
                      max={300}
                      className="w-20 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              disabled={!goal.trim() || creating}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
            >
              {creating ? 'Starting...' : 'Start Supervision'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
