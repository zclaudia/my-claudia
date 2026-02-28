import { useState, useCallback } from 'react';
import type { SupervisionPlan } from '@my-claudia/shared';
import * as api from '../services/api';
import { useSupervisionStore } from '../stores/supervisionStore';

interface PlanReviewDialogProps {
  supervisionId: string;
  plan: SupervisionPlan;
  isOpen: boolean;
  onClose: () => void;
}

export function PlanReviewDialog({ supervisionId, plan, isOpen, onClose }: PlanReviewDialogProps) {
  const [editGoal, setEditGoal] = useState(plan.goal);
  const [editSubtasks, setEditSubtasks] = useState(
    plan.subtasks.map(st => ({
      description: st.description,
      phase: st.phase || 1,
      acceptanceCriteria: st.acceptanceCriteria || [],
    }))
  );
  const [editAcceptanceCriteria, setEditAcceptanceCriteria] = useState<string[]>(
    plan.acceptanceCriteria || []
  );
  const [maxIterations, setMaxIterations] = useState<number | ''>(
    plan.estimatedIterations || ''
  );
  const [cooldownSeconds, setCooldownSeconds] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultMaxIter = editSubtasks.length > 0 ? editSubtasks.length * 3 : 5;

  const handleApprove = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const approvedPlan: SupervisionPlan & { maxIterations?: number; cooldownSeconds?: number } = {
        goal: editGoal,
        subtasks: editSubtasks,
        acceptanceCriteria: editAcceptanceCriteria.length > 0 ? editAcceptanceCriteria : undefined,
        maxIterations: maxIterations || undefined,
        cooldownSeconds,
      };
      const supervision = await api.approvePlan(supervisionId, approvedPlan);
      useSupervisionStore.getState().updateSupervision(supervision);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve plan');
      setLoading(false);
    }
  }, [supervisionId, editGoal, editSubtasks, editAcceptanceCriteria, maxIterations, cooldownSeconds, onClose]);

  // Subtask editing helpers
  const handleUpdateSubtask = useCallback((index: number, field: string, value: string | number | string[]) => {
    setEditSubtasks(prev => prev.map((st, i) => i === index ? { ...st, [field]: value } : st));
  }, []);

  const handleRemoveSubtask = useCallback((index: number) => {
    setEditSubtasks(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleAddSubtask = useCallback(() => {
    const maxPhase = editSubtasks.reduce((max, st) => Math.max(max, st.phase), 1);
    setEditSubtasks(prev => [...prev, { description: '', phase: maxPhase, acceptanceCriteria: [] }]);
  }, [editSubtasks]);

  // Acceptance criteria helpers
  const handleAddCriterion = useCallback(() => {
    setEditAcceptanceCriteria(prev => [...prev, '']);
  }, []);

  const handleUpdateCriterion = useCallback((index: number, value: string) => {
    setEditAcceptanceCriteria(prev => prev.map((c, i) => i === index ? value : c));
  }, []);

  const handleRemoveCriterion = useCallback((index: number) => {
    setEditAcceptanceCriteria(prev => prev.filter((_, i) => i !== index));
  }, []);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg pointer-events-auto flex flex-col"
          style={{ maxHeight: '80vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <h2 className="text-base font-semibold">Review Plan</h2>
            <button
              onClick={onClose}
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
                value={editGoal}
                onChange={(e) => setEditGoal(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-secondary border border-border rounded text-sm resize-none focus:outline-none focus:border-primary"
              />
            </div>

            {/* Overall Acceptance Criteria */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Acceptance Criteria</label>
                <button
                  onClick={handleAddCriterion}
                  className="text-xs text-primary hover:text-primary/80"
                >
                  + Add
                </button>
              </div>
              {editAcceptanceCriteria.length > 0 ? (
                <ul className="space-y-1">
                  {editAcceptanceCriteria.map((criterion, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs">-</span>
                      <input
                        type="text"
                        value={criterion}
                        onChange={(e) => handleUpdateCriterion(i, e.target.value)}
                        className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => handleRemoveCriterion(i)}
                        className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-destructive flex-shrink-0"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No acceptance criteria. Click + Add to define how to verify goal completion.</p>
              )}
            </div>

            {/* Subtasks grouped by phase */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Subtasks</label>
                <button
                  onClick={handleAddSubtask}
                  className="text-xs text-primary hover:text-primary/80"
                >
                  + Add Subtask
                </button>
              </div>
              {editSubtasks.length > 0 ? (
                <div className="space-y-2">
                  {editSubtasks.map((st, i) => (
                    <div key={i} className="border border-border rounded p-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-5 text-right flex-shrink-0">{i + 1}.</span>
                        <input
                          type="text"
                          value={st.description}
                          onChange={(e) => handleUpdateSubtask(i, 'description', e.target.value)}
                          placeholder="Subtask description..."
                          className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                        />
                        <select
                          value={st.phase}
                          onChange={(e) => handleUpdateSubtask(i, 'phase', parseInt(e.target.value))}
                          className="px-1 py-1 bg-secondary border border-border rounded text-xs focus:outline-none focus:border-primary"
                        >
                          {[1, 2, 3, 4, 5].map(p => (
                            <option key={p} value={p}>Phase {p}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRemoveSubtask(i)}
                          className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-destructive flex-shrink-0"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {/* Per-subtask acceptance criteria */}
                      <div className="pl-7">
                        {st.acceptanceCriteria.map((ac, j) => (
                          <div key={j} className="flex items-center gap-1 mb-1">
                            <span className="text-xs text-muted-foreground">-</span>
                            <input
                              type="text"
                              value={ac}
                              onChange={(e) => {
                                const updated = [...st.acceptanceCriteria];
                                updated[j] = e.target.value;
                                handleUpdateSubtask(i, 'acceptanceCriteria', updated);
                              }}
                              className="flex-1 px-1.5 py-0.5 bg-secondary border border-border rounded text-xs focus:outline-none focus:border-primary"
                            />
                            <button
                              onClick={() => {
                                const updated = st.acceptanceCriteria.filter((_, k) => k !== j);
                                handleUpdateSubtask(i, 'acceptanceCriteria', updated);
                              }}
                              className="p-0.5 text-muted-foreground hover:text-destructive"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            handleUpdateSubtask(i, 'acceptanceCriteria', [...st.acceptanceCriteria, '']);
                          }}
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          + criterion
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No subtasks defined.</p>
              )}
            </div>

            {/* Settings */}
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm">Max iterations</label>
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
                <label className="text-sm">Cooldown (s)</label>
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
              onClick={onClose}
              className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
            >
              Back to Chat
            </button>
            <button
              onClick={handleApprove}
              disabled={!editGoal.trim() || loading}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
            >
              {loading ? 'Starting...' : 'Approve & Start'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
