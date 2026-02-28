import { useState, useCallback } from 'react';
import type { SupervisionPlan } from '@my-claudia/shared';
import * as api from '../services/api';
import { useSupervisionStore } from '../stores/supervisionStore';

interface SuperviseDialogProps {
  sessionId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Extract JSON plan from markdown code fences in assistant messages.
 * Exported for reuse by ChatInterface and PlanReviewDialog.
 */
export function extractPlanFromMessages(messages: Array<{ role: string; content: string }>): SupervisionPlan | null {
  // Look at messages in reverse order (latest first)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    const jsonMatch = msg.content.match(/```json\s*\n([\s\S]*?)\n\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.goal && Array.isArray(parsed.subtasks)) {
          return parsed as SupervisionPlan;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }
  return null;
}

export function SuperviseDialog({ sessionId, isOpen, onClose }: SuperviseDialogProps) {
  const [goal, setGoal] = useState('');
  const [quickSubtasks, setQuickSubtasks] = useState<string[]>([]);
  const [newQuickSubtask, setNewQuickSubtask] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [maxIterations, setMaxIterations] = useState<number | ''>('');
  const [cooldownSeconds, setCooldownSeconds] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setGoal('');
    setQuickSubtasks([]);
    setNewQuickSubtask('');
    setShowSettings(false);
    setMaxIterations('');
    setCooldownSeconds(5);
    setLoading(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  // AI Planning: create supervision, set pending hint, close dialog
  const handleStartPlanning = useCallback(async () => {
    if (!sessionId || !goal.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.startSupervisionPlanning({
        sessionId,
        hint: goal.trim(),
      });
      useSupervisionStore.getState().updateSupervision(result.supervision);
      // Set pending hint so ChatInterface auto-sends it as a run_start message
      useSupervisionStore.getState().setPendingHint(sessionId, goal.trim());
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start planning');
      setLoading(false);
    }
  }, [sessionId, goal, resetForm, onClose]);

  // Quick Start: create supervision directly and close
  const handleQuickStart = useCallback(async () => {
    if (!sessionId || !goal.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const supervision = await api.createSupervision({
        sessionId,
        goal: goal.trim(),
        subtasks: quickSubtasks.length > 0 ? quickSubtasks : undefined,
        maxIterations: maxIterations || undefined,
        cooldownSeconds,
      });
      useSupervisionStore.getState().updateSupervision(supervision);
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create supervision');
      setLoading(false);
    }
  }, [sessionId, goal, quickSubtasks, maxIterations, cooldownSeconds, resetForm, onClose]);

  const handleAddQuickSubtask = useCallback(() => {
    const trimmed = newQuickSubtask.trim();
    if (!trimmed) return;
    setQuickSubtasks(prev => [...prev, trimmed]);
    setNewQuickSubtask('');
  }, [newQuickSubtask]);

  const handleRemoveQuickSubtask = useCallback((index: number) => {
    setQuickSubtasks(prev => prev.filter((_, i) => i !== index));
  }, []);

  if (!isOpen || !sessionId) return null;

  const defaultMaxIter = quickSubtasks.length > 0 ? quickSubtasks.length * 3 : 5;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={handleClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg pointer-events-auto flex flex-col"
          style={{ maxHeight: '80vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
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
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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
            </div>

            {/* Quick Start section: subtasks & settings */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Subtasks <span className="text-muted-foreground font-normal">(optional, for Quick Start)</span>
              </label>
              {quickSubtasks.length > 0 && (
                <ul className="space-y-1 mb-2">
                  {quickSubtasks.map((task, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground text-xs w-5 text-right flex-shrink-0">{i + 1}.</span>
                      <span className="flex-1 truncate">{task}</span>
                      <button
                        onClick={() => handleRemoveQuickSubtask(i)}
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
                  value={newQuickSubtask}
                  onChange={(e) => setNewQuickSubtask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddQuickSubtask();
                    }
                  }}
                  placeholder="Add a subtask..."
                  className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                />
                <button
                  onClick={handleAddQuickSubtask}
                  disabled={!newQuickSubtask.trim()}
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
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
            >
              Cancel
            </button>
            <button
              onClick={handleQuickStart}
              disabled={!goal.trim() || loading}
              className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded disabled:opacity-50"
            >
              Quick Start
            </button>
            <button
              onClick={handleStartPlanning}
              disabled={!goal.trim() || loading}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
            >
              {loading ? 'Starting...' : 'AI Planning'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
