import { useState, useCallback, useEffect, useRef } from 'react';
import type { SupervisionPlan } from '@my-claudia/shared';
import * as api from '../services/api';
import { useSupervisionStore } from '../stores/supervisionStore';
import { useChatStore } from '../stores/chatStore';

interface SuperviseDialogProps {
  sessionId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

type Phase = 'input' | 'chat' | 'review';

// Extract JSON plan from markdown code fences in assistant messages
function extractPlanFromMessages(messages: Array<{ role: string; content: string }>): SupervisionPlan | null {
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
  // Phase management
  const [phase, setPhase] = useState<Phase>('input');

  // Input phase state
  const [goal, setGoal] = useState('');

  // Chat phase state
  const [supervisionId, setSupervisionId] = useState<string | null>(null);
  const [planSessionId, setPlanSessionId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Review phase state
  const [parsedPlan, setParsedPlan] = useState<SupervisionPlan | null>(null);
  const [editGoal, setEditGoal] = useState('');
  const [editSubtasks, setEditSubtasks] = useState<Array<{
    description: string;
    phase: number;
    acceptanceCriteria: string[];
  }>>([]);
  const [editAcceptanceCriteria, setEditAcceptanceCriteria] = useState<string[]>([]);
  const [maxIterations, setMaxIterations] = useState<number | ''>('');
  const [cooldownSeconds, setCooldownSeconds] = useState(5);

  // Quick Start state (original behavior)
  const [quickSubtasks, setQuickSubtasks] = useState<string[]>([]);
  const [newQuickSubtask, setNewQuickSubtask] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Common state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to plan session messages from chatStore
  const planMessages = useChatStore(
    (state) => planSessionId ? (state.messages[planSessionId] || []) : []
  );

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [planMessages]);

  // Detect plan JSON in streaming messages → auto-transition to review
  useEffect(() => {
    if (phase !== 'chat' || planMessages.length === 0) return;

    const plan = extractPlanFromMessages(
      planMessages.map(m => ({ role: m.role, content: m.content }))
    );
    if (plan) {
      setParsedPlan(plan);
      setEditGoal(plan.goal);
      setEditSubtasks(
        plan.subtasks.map(st => ({
          description: st.description,
          phase: st.phase || 1,
          acceptanceCriteria: st.acceptanceCriteria || [],
        }))
      );
      setEditAcceptanceCriteria(plan.acceptanceCriteria || []);
      if (plan.estimatedIterations) {
        setMaxIterations(plan.estimatedIterations);
      }
    }
  }, [phase, planMessages]);

  // Track streaming state via chatStore's active runs
  useEffect(() => {
    if (!planSessionId) return;
    const check = () => {
      const isActive = useChatStore.getState().isSessionLoading(planSessionId);
      setIsStreaming(isActive);
    };
    check();
    const unsub = useChatStore.subscribe(check);
    return unsub;
  }, [planSessionId]);

  const resetForm = useCallback(() => {
    setPhase('input');
    setGoal('');
    setSupervisionId(null);
    setPlanSessionId(null);
    setChatInput('');
    setIsStreaming(false);
    setParsedPlan(null);
    setEditGoal('');
    setEditSubtasks([]);
    setEditAcceptanceCriteria([]);
    setMaxIterations('');
    setCooldownSeconds(5);
    setQuickSubtasks([]);
    setNewQuickSubtask('');
    setShowSettings(false);
    setLoading(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    // If we're in planning phase, cancel it
    if (supervisionId && phase !== 'input') {
      api.cancelPlanning(supervisionId).catch(() => {});
    }
    resetForm();
    onClose();
  }, [resetForm, onClose, supervisionId, phase]);

  // ========================================
  // Phase A: Input
  // ========================================

  const handleStartPlanning = useCallback(async () => {
    if (!sessionId || !goal.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.startSupervisionPlanning({
        sessionId,
        hint: goal.trim(),
      });
      setSupervisionId(result.supervision.id);
      setPlanSessionId(result.planSessionId);
      useSupervisionStore.getState().updateSupervision(result.supervision);
      setPhase('chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start planning');
    } finally {
      setLoading(false);
    }
  }, [sessionId, goal]);

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

  // ========================================
  // Phase B: Chat
  // ========================================

  const handleChatSend = useCallback(async () => {
    if (!supervisionId || !chatInput.trim() || isStreaming) return;
    const message = chatInput.trim();
    setChatInput('');
    setError(null);
    try {
      await api.respondToPlanning(supervisionId, message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send response');
    }
  }, [supervisionId, chatInput, isStreaming]);

  const handleGoToReview = useCallback(() => {
    if (parsedPlan) {
      setPhase('review');
    }
  }, [parsedPlan]);

  // ========================================
  // Phase C: Review & Approve
  // ========================================

  const handleApprove = useCallback(async () => {
    if (!supervisionId) return;
    setLoading(true);
    setError(null);
    try {
      const plan: SupervisionPlan & { maxIterations?: number; cooldownSeconds?: number } = {
        goal: editGoal,
        subtasks: editSubtasks,
        acceptanceCriteria: editAcceptanceCriteria.length > 0 ? editAcceptanceCriteria : undefined,
        maxIterations: maxIterations || undefined,
        cooldownSeconds,
      };
      const supervision = await api.approvePlan(supervisionId, plan);
      useSupervisionStore.getState().updateSupervision(supervision);
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve plan');
      setLoading(false);
    }
  }, [supervisionId, editGoal, editSubtasks, editAcceptanceCriteria, maxIterations, cooldownSeconds, resetForm, onClose]);

  const handleBackToChat = useCallback(() => {
    setPhase('chat');
  }, []);

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

  // Quick subtask helpers
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

  const defaultMaxIter = editSubtasks.length > 0 ? editSubtasks.length * 3 : (quickSubtasks.length > 0 ? quickSubtasks.length * 3 : 5);

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
            <h2 className="text-base font-semibold">
              {phase === 'input' && 'Supervise Session'}
              {phase === 'chat' && 'Planning Conversation'}
              {phase === 'review' && 'Review Plan'}
            </h2>
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
            {phase === 'input' && renderInputPhase()}
            {phase === 'chat' && renderChatPhase()}
            {phase === 'review' && renderReviewPhase()}

            {/* Error */}
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
            {phase === 'input' && renderInputFooter()}
            {phase === 'chat' && renderChatFooter()}
            {phase === 'review' && renderReviewFooter()}
          </div>
        </div>
      </div>
    </>
  );

  // ========================================
  // Phase A: Input
  // ========================================

  function renderInputPhase() {
    return (
      <>
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
      </>
    );
  }

  function renderInputFooter() {
    return (
      <>
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
      </>
    );
  }

  // ========================================
  // Phase B: Chat
  // ========================================

  function renderChatPhase() {
    return (
      <>
        {/* Chat messages */}
        <div className="space-y-3 min-h-[200px]">
          {planMessages.map((msg, i) => (
            <div key={msg.id || i} className={`text-sm ${msg.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`inline-block max-w-[90%] px-3 py-2 rounded-lg ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-foreground'
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{msg.content || (isStreaming ? '...' : '')}</div>
              </div>
            </div>
          ))}
          {isStreaming && planMessages.length > 0 && planMessages[planMessages.length - 1]?.role === 'assistant' && (
            <div className="text-xs text-muted-foreground animate-pulse">Thinking...</div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Plan detected banner */}
        {parsedPlan && !isStreaming && (
          <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded text-sm">
            <span className="flex-1">Plan detected in conversation</span>
            <button
              onClick={handleGoToReview}
              className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Review Plan
            </button>
          </div>
        )}

        {/* Chat input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleChatSend();
              }
            }}
            placeholder="Reply to Claude..."
            disabled={isStreaming}
            className="flex-1 px-3 py-2 bg-secondary border border-border rounded text-sm focus:outline-none focus:border-primary disabled:opacity-50"
          />
          <button
            onClick={handleChatSend}
            disabled={!chatInput.trim() || isStreaming}
            className="px-3 py-2 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </>
    );
  }

  function renderChatFooter() {
    return (
      <>
        <button
          onClick={handleClose}
          className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
        >
          Cancel
        </button>
        {parsedPlan && !isStreaming && (
          <button
            onClick={handleGoToReview}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded"
          >
            Review Plan
          </button>
        )}
      </>
    );
  }

  // ========================================
  // Phase C: Review
  // ========================================

  function renderReviewPhase() {
    return (
      <>
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
      </>
    );
  }

  function renderReviewFooter() {
    return (
      <>
        <button
          onClick={handleBackToChat}
          className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
        >
          Back to Chat
        </button>
        <button
          onClick={handleClose}
          className="px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded"
        >
          Cancel
        </button>
        <button
          onClick={handleApprove}
          disabled={!editGoal.trim() || loading}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Approve & Start'}
        </button>
      </>
    );
  }
}
