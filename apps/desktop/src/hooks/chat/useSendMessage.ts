import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { AgentPermissionPolicy, ClientMessage, MessageAttachment, MessageInput as MessageInputData } from '@my-claudia/shared';
import type { Attachment } from '../../components/chat/MessageInput';
import type { MessageWithToolCalls } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { uploadFile } from '../../services/fileUpload';
import * as api from '../../services/api';

const ATTACHMENT_PLACEHOLDER = '[Attachments]';

interface RunStartMessage {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  resend?: boolean;
  mode?: string;
  model?: string;
  permissionOverride?: Partial<AgentPermissionPolicy>;
  workingDirectory?: string;
}

interface UseSendMessageParams {
  sessionId: string;
  isConnected: boolean;
  isLoading: boolean;
  sessionRunId: string | null;
  isSessionRunning: boolean;
  lastSessionMessage: MessageWithToolCalls | null;
  mode: string;
  modelOverride: string;
  permissionOverride: Partial<AgentPermissionPolicy> | null;
  currentSession: { workingDirectory?: string; lastRunStatus?: string | null } | undefined;
  addMessage: (sessionId: string, message: MessageWithToolCalls) => void;
  scrollToBottom: (instant?: boolean) => void;
  wsSendMessage: (msg: ClientMessage) => void;
}

export function useSendMessage({
  sessionId,
  isConnected,
  isLoading,
  sessionRunId,
  isSessionRunning,
  lastSessionMessage,
  mode,
  modelOverride,
  permissionOverride,
  currentSession,
  addMessage,
  scrollToBottom,
  wsSendMessage,
}: UseSendMessageParams) {
  // ── Local state ──
  const [lastSentMessage, setLastSentMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [resendChecking, setResendChecking] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);

  // ── Resend logic ──
  const resendTargetMessage = useMemo(() => {
    if (!lastSessionMessage || lastSessionMessage.role !== 'user' || isSessionRunning) {
      return null;
    }
    return lastSessionMessage;
  }, [lastSessionMessage, isSessionRunning]);

  const resendText = useMemo(() => {
    if (!resendTargetMessage) return null;
    const raw = (resendTargetMessage.content || '').trim();
    if (!raw || raw === ATTACHMENT_PLACEHOLDER) return null;
    try {
      const parsed = JSON.parse(raw) as { text?: string };
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        const text = parsed.text.trim();
        return text || null;
      }
    } catch {
      // Plain text fallback
    }
    return raw;
  }, [resendTargetMessage]);

  // ── Internal helpers ──
  const clearInterruptedStatus = useCallback(async () => {
    if (currentSession?.lastRunStatus !== 'interrupted') return;
    useProjectStore.getState().updateSession(sessionId, { lastRunStatus: null });
    try {
      await api.dismissInterrupted(sessionId);
    } catch (error) {
      console.warn('[useSendMessage] Failed to persist interrupted status dismissal:', error);
    }
  }, [currentSession?.lastRunStatus, sessionId]);

  const startRun = useCallback(async (runStartMsg: RunStartMessage) => {
    await clearInterruptedStatus();
    wsSendMessage(runStartMsg);
  }, [clearInterruptedStatus, wsSendMessage]);

  // ── Send message ──
  const handleSendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    if (!content.trim() && !attachments?.length) return;

    if (!isConnected) {
      setQueuedMessage({ content, attachments });
      return;
    }

    if (isLoading) {
      setQueuedMessage({ content, attachments });
      return;
    }

    setLastSentMessage({ content, attachments });
    setRestoreMessage(null);
    setUploadError(null);

    let uploadedAttachments: MessageAttachment[] = [];

    if (attachments && attachments.length > 0) {
      try {
        for (const attachment of attachments) {
          const blob = await (await fetch(attachment.data)).blob();
          const file = new File([blob], attachment.name, { type: attachment.mimeType });
          const uploaded = await uploadFile(file);
          uploadedAttachments.push({
            fileId: uploaded.fileId,
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            type: attachment.type
          });
        }
      } catch (error) {
        console.error('Failed to upload attachments:', error);
        setUploadError(error instanceof Error ? error.message : 'Failed to upload file');
        return;
      }
    }

    const messageInput: MessageInputData = {
      text: content,
      attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined
    };

    const fullContent = JSON.stringify(messageInput);
    const clientMessageId = crypto.randomUUID();

    addMessage(sessionId, {
      id: clientMessageId,
      clientMessageId,
      sessionId,
      role: 'user',
      content: content || ATTACHMENT_PLACEHOLDER,
      createdAt: Date.now(),
    });

    const runStartMsg: RunStartMessage = {
      type: 'run_start',
      clientRequestId: clientMessageId,
      sessionId,
      input: fullContent,
      mode: mode || undefined,
      model: modelOverride || undefined,
      permissionOverride: permissionOverride || undefined,
      workingDirectory: currentSession?.workingDirectory || undefined,
    };
    console.log('[useSendMessage] run_start:', { sessionId, mode: runStartMsg.mode, model: runStartMsg.model, workingDirectory: runStartMsg.workingDirectory });
    await startRun(runStartMsg);

    setTimeout(() => scrollToBottom(), 100);
  }, [sessionId, isConnected, isLoading, mode, modelOverride, permissionOverride, currentSession, addMessage, startRun, scrollToBottom]);

  // ── Auto-send queued message when the current run finishes ──
  const queuedMessageRef = useRef(queuedMessage);
  queuedMessageRef.current = queuedMessage;
  const handleSendMessageRef = useRef(handleSendMessage);
  handleSendMessageRef.current = handleSendMessage;

  useEffect(() => {
    if (!isLoading && isConnected && queuedMessageRef.current) {
      const { content, attachments } = queuedMessageRef.current;
      setQueuedMessage(null);
      setTimeout(() => handleSendMessageRef.current?.(content, attachments), 0);
    }
  }, [isLoading, isConnected]);

  // ── Resend last message ──
  const handleResendLastMessage = useCallback(async () => {
    if (!resendText) return;
    setResendChecking(true);
    try {
      const runState = await api.getSessionRunState(sessionId);
      if (runState.isRunning) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Cannot resend yet: session is still running${runState.activeRunId ? ` (${runState.activeRunId})` : ''}.`,
          createdAt: Date.now(),
        });
        return;
      }
      const messageInput: MessageInputData = { text: resendText };
      await startRun({
        type: 'run_start',
        clientRequestId: crypto.randomUUID(),
        sessionId,
        input: JSON.stringify(messageInput),
        resend: true,
        mode: mode || undefined,
        model: modelOverride || undefined,
        permissionOverride: permissionOverride || undefined,
        workingDirectory: currentSession?.workingDirectory || undefined,
      });
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('Resend preflight failed:', error);
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: 'Resend preflight failed. Please try again.',
        createdAt: Date.now(),
      });
    } finally {
      setResendChecking(false);
    }
  }, [resendText, sessionId, addMessage, startRun, mode, modelOverride, permissionOverride, currentSession, scrollToBottom]);

  // ── Cancel / queue actions ──
  const handleCancelRun = useCallback(() => {
    if (lastSentMessage) {
      setRestoreMessage(lastSentMessage);
      setLastSentMessage(null);
    }
    if (!sessionRunId) {
      console.warn('[useSendMessage] No active run for this session');
      return;
    }
    wsSendMessage({ type: 'run_cancel', runId: sessionRunId });
  }, [lastSentMessage, sessionRunId, wsSendMessage]);

  const handleSendNow = useCallback(() => {
    if (!sessionRunId) return;
    setLastSentMessage(null);
    wsSendMessage({ type: 'run_cancel', runId: sessionRunId });
  }, [sessionRunId, wsSendMessage]);

  const handleDismissQueue = useCallback(() => {
    const msg = queuedMessage;
    setQueuedMessage(null);
    if (msg) {
      setRestoreMessage({ content: msg.content, attachments: msg.attachments });
    }
  }, [queuedMessage]);

  // ── Reset on session switch ──
  const resetSendState = useCallback(() => {
    setLastSentMessage(null);
    setRestoreMessage(null);
    setUploadError(null);
    setResendChecking(false);
    setQueuedMessage(null);
  }, []);

  return {
    handleSendMessage,
    handleCancelRun,
    handleSendNow,
    handleDismissQueue,
    handleResendLastMessage,
    startRun,
    clearInterruptedStatus,
    // State
    restoreMessage,
    uploadError,
    queuedMessage,
    resendTargetMessage,
    resendText,
    resendChecking,
    // Reset
    resetSendState,
  };
}
