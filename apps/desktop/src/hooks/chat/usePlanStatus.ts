import { useEffect, useState, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useSupervisionStore } from '../../stores/supervisionStore';
import * as api from '../../services/api';
import type { MessageRole, Session } from '@my-claudia/shared';

interface UsePlanStatusParams {
  sessionId: string;
  isConnected: boolean;
  isForcedPlanSession: boolean;
  currentSession: Session | undefined;
  currentProjectId: string | undefined;
  messagesLength: number;
  addMessage: (sessionId: string, message: { id: string; sessionId: string; role: MessageRole; content: string; createdAt: number }) => void;
  scrollToBottom: () => void;
  handleSendMessage: (content: string) => void;
}

export function usePlanStatus({
  sessionId,
  isConnected,
  isForcedPlanSession,
  currentSession,
  currentProjectId,
  messagesLength,
  addMessage,
  scrollToBottom,
  handleSendMessage,
}: UsePlanStatusParams) {
  const [taskPlanStatus, setTaskPlanStatus] = useState<api.TaskPlanStatus | null>(null);
  const [planStatusLoading, setPlanStatusLoading] = useState(false);
  const [submitPlanLoading, setSubmitPlanLoading] = useState(false);
  const [discardPlanLoading, setDiscardPlanLoading] = useState(false);

  // Auto-check plan document completeness during task planning
  useEffect(() => {
    const taskId = currentSession?.taskId;
    if (!isConnected || !isForcedPlanSession || !taskId) {
      setTaskPlanStatus(null);
      return;
    }

    let cancelled = false;
    setPlanStatusLoading(true);
    api.getTaskPlanStatus(taskId)
      .then((status) => {
        if (!cancelled) setTaskPlanStatus(status);
      })
      .catch(() => {
        if (!cancelled) setTaskPlanStatus(null);
      })
      .finally(() => {
        if (!cancelled) setPlanStatusLoading(false);
      });

    return () => { cancelled = true; };
  }, [isConnected, isForcedPlanSession, currentSession?.taskId, messagesLength]);

  const handleRestorePlan = useCallback(() => {
    const taskId = currentSession?.taskId;
    if (!taskId) return;
    handleSendMessage(`Please read the existing plan document at \`.supervision/plans/task-${taskId}.plan.md\` and summarize it. Then ask me whether I'd like to:\n1. Submit the plan and start implementation\n2. Continue refining the plan`);
  }, [currentSession?.taskId, handleSendMessage]);

  const handleDiscardPlan = useCallback(async () => {
    const taskId = currentSession?.taskId;
    if (!taskId || discardPlanLoading) return;
    const ok = window.confirm('Discard current plan and cancel this task?');
    if (!ok) return;
    try {
      setDiscardPlanLoading(true);
      const task = await api.cancelTask(taskId);
      if (currentProjectId) {
        useSupervisionStore.getState().upsertTask(currentProjectId, task);
      }
      useProjectStore.getState().updateSession(sessionId, {
        isReadOnly: false,
        planStatus: undefined,
      });
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: 'Plan discarded. Task has been cancelled.',
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    } catch (err) {
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: `Failed to discard plan: ${(err as Error).message}`,
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    } finally {
      setDiscardPlanLoading(false);
    }
  }, [currentSession?.taskId, discardPlanLoading, currentProjectId, sessionId, addMessage, scrollToBottom]);

  const handleSubmitPlan = useCallback(async () => {
    const taskId = currentSession?.taskId;
    if (!taskId || submitPlanLoading) return;
    try {
      setSubmitPlanLoading(true);
      const result = await api.submitTaskPlan(taskId);
      useProjectStore.getState().updateSession(sessionId, {
        isReadOnly: true,
        planStatus: 'planned',
      });
      if (currentProjectId) {
        useSupervisionStore.getState().upsertTask(currentProjectId, result.task);
      }
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: 'Plan submitted to Supervisor. Waiting for execution.',
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    } catch (err) {
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: `Failed to submit plan: ${(err as Error).message}`,
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    } finally {
      setSubmitPlanLoading(false);
    }
  }, [currentSession?.taskId, submitPlanLoading, sessionId, currentProjectId, addMessage, scrollToBottom]);

  return {
    taskPlanStatus,
    planStatusLoading,
    submitPlanLoading,
    discardPlanLoading,
    handleRestorePlan,
    handleDiscardPlan,
    handleSubmitPlan,
  };
}
