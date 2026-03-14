import { useState, useCallback } from 'react';
import type { SupervisionTask } from '@my-claudia/shared';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';
import { useAndroidBack } from '../../hooks/useAndroidBack';

interface CreateTaskDialogProps {
  projectId: string;
  existingTasks: SupervisionTask[];
  isOpen: boolean;
  onClose: () => void;
}

export function CreateTaskDialog({ projectId, existingTasks, isOpen, onClose }: CreateTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(0);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [newCriterion, setNewCriterion] = useState('');
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upsertTask = useSupervisionStore((s) => s.upsertTask);

  const resetForm = useCallback(() => {
    setTitle('');
    setDescription('');
    setPriority(0);
    setCriteria([]);
    setNewCriterion('');
    setSelectedDeps([]);
    setLoading(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  useAndroidBack(handleClose, isOpen, 20);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const task = await api.createSupervisionTask(projectId, {
        title: title.trim(),
        description: description.trim(),
        priority,
        acceptanceCriteria: criteria.length > 0 ? criteria : undefined,
        dependencies: selectedDeps.length > 0 ? selectedDeps : undefined,
      });
      upsertTask(projectId, task);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
      setLoading(false);
    }
  }, [projectId, title, description, priority, criteria, selectedDeps, upsertTask, handleClose]);

  const handleAddCriterion = useCallback(() => {
    const trimmed = newCriterion.trim();
    if (!trimmed) return;
    setCriteria((prev) => [...prev, trimmed]);
    setNewCriterion('');
  }, [newCriterion]);

  const toggleDep = useCallback((taskId: string) => {
    setSelectedDeps((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  }, []);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={handleClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg pointer-events-auto flex flex-col"
          style={{ maxHeight: '80vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <h2 className="text-base font-semibold">Create Task</h2>
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
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title..."
                className="w-full px-3 py-2 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this task should accomplish..."
                rows={3}
                className="w-full px-3 py-2 bg-secondary border border-border rounded text-sm resize-none focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Priority (lower = higher priority)</label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                min={0}
                max={10}
                className="w-20 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
              />
            </div>

            {/* Acceptance criteria */}
            <div>
              <label className="block text-sm font-medium mb-1">Acceptance Criteria</label>
              {criteria.length > 0 && (
                <ul className="space-y-1 mb-2">
                  {criteria.map((c, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground text-xs w-5 text-right flex-shrink-0">{i + 1}.</span>
                      <span className="flex-1 truncate">{c}</span>
                      <button
                        onClick={() => setCriteria((prev) => prev.filter((_, j) => j !== i))}
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
                  value={newCriterion}
                  onChange={(e) => setNewCriterion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleAddCriterion(); }
                  }}
                  placeholder="Add acceptance criterion..."
                  className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary"
                />
                <button
                  onClick={handleAddCriterion}
                  disabled={!newCriterion.trim()}
                  className="px-2 py-1 text-xs bg-secondary border border-border rounded hover:bg-secondary/80 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Dependencies */}
            {existingTasks.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Dependencies</label>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {existingTasks.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedDeps.includes(t.id)}
                        onChange={() => toggleDep(t.id)}
                        className="rounded"
                      />
                      <span className="truncate">{t.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

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
              onClick={handleSubmit}
              disabled={!title.trim() || loading}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
