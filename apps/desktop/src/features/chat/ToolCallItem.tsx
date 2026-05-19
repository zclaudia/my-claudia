import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { type ToolCallState } from '../../stores/chatStore';
import { getToolIcon } from '../../config/icons';
import { Icon } from '../../components/ui/Icon';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useSelectionStore } from '../../stores/selectionStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { InteractionItem } from './InteractionItem';
import {
  isTodoTool,
  isAskUserFormTool,
  isApprovalTool,
  isPushFileTool,
  isPlanProposalTool,
  isInteractionTool,
} from './tool-call/toolClassifiers';
import {
  normalizeToolInput,
  extractQuestions,
  extractInteractionId,
  buildAskUserQuestionInteraction,
  formatToolInput,
} from './tool-call/toolFormatters';
import { ToolExpandedContent } from './tool-call/ToolExpandedContent';

interface ToolCallItemProps {
  toolCall: ToolCallState;
}

export const ToolCallItem = memo(function ToolCallItem({ toolCall }: ToolCallItemProps) {
  // Plan proposals auto-expand on completion so the plan body and the
  // "Execute plan" button are visible without an extra click. The state is
  // user-toggleable afterwards; `autoExpandedRef` ensures we only auto-expand
  // once per tool call (so user collapses stick).
  const [isExpanded, setIsExpanded] = useState(() =>
    isPlanProposalTool(toolCall.toolName, toolCall.semantic) && toolCall.status === 'completed',
  );
  const autoExpandedRef = useRef(
    isPlanProposalTool(toolCall.toolName, toolCall.semantic) && toolCall.status === 'completed',
  );
  useEffect(() => {
    if (autoExpandedRef.current) return;
    if (!isPlanProposalTool(toolCall.toolName, toolCall.semantic)) return;
    if (toolCall.status !== 'completed') return;
    autoExpandedRef.current = true;
    setIsExpanded(true);
  }, [toolCall.status, toolCall.toolName, toolCall.semantic]);
  const { toolName, toolInput, status, result, isError, activity, semantic } = toolCall;
  const selectedSessionId = useSelectionStore((s) => s.selectedSessionId);
  const pendingPromptRequest = usePromptRequestStore((s) => {
    if (!selectedSessionId || toolName !== 'AskUserQuestion') return null;
    for (let i = s.pendingRequests.length - 1; i >= 0; i--) {
      if (
        s.pendingRequests[i].sessionId === selectedSessionId
        && s.pendingRequests[i].requestId === toolCall.id
      ) {
        return s.pendingRequests[i];
      }
    }
    return null;
  });
  const fallbackPromptInteraction = useMemo(() => {
    if (!selectedSessionId || !pendingPromptRequest || toolName !== 'AskUserQuestion') return null;
    const normalizedInput = normalizeToolInput(toolInput) as Record<string, unknown> | undefined;
    const questions = extractQuestions(normalizedInput?.questions);
    if (questions.length === 0) return null;
    return buildAskUserQuestionInteraction({
      interactionId: pendingPromptRequest.requestId,
      sessionId: selectedSessionId,
      questions,
    });
  }, [pendingPromptRequest, selectedSessionId, toolInput, toolName]);

  // Phase 1 dedup: render InteractionItem instead of interaction tool when interaction store has it
  const interactionId = extractInteractionId(result);
  const interaction = useInteractionStore((s) => {
    const direct = s.interactions[toolCall.id] || (interactionId ? s.interactions[interactionId] : undefined);
    if (direct) return direct;

    // A plan-proposal tool creates a separate interaction before the tool
    // result exists. We match on the shared semantic (plus the MCP bridge
    // suffix fallback) instead of provider-specific tool names.
    if (selectedSessionId && status === 'running' && isPlanProposalTool(toolName, semantic)) {
      return Object.values(s.interactions)
        .filter((item) => item.sessionId === selectedSessionId && item.type === 'interaction_plan_review')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    return undefined;
  });
  const resolvedInteraction = interaction ?? fallbackPromptInteraction;
  if (resolvedInteraction && isInteractionTool(toolName, semantic)) {
    if (resolvedInteraction.type === 'interaction_todo_update' && resolvedInteraction.todos.length > 0) {
      return <InteractionItem interaction={resolvedInteraction} />;
    }
    if (resolvedInteraction.type === 'interaction_prompt' || resolvedInteraction.type === 'interaction_approval' || resolvedInteraction.type === 'interaction_plan_review') {
      return <InteractionItem interaction={resolvedInteraction} />;
    }
  }

  const icon = getToolIcon(toolName);
  const displayName = isTodoTool(toolName) ? 'TodoWrite'
    : isAskUserFormTool(toolName) ? 'AskUserForm'
    : isApprovalTool(toolName) ? 'RequestApproval'
    : isPushFileTool(toolName) ? 'PushFile'
    : toolName;
  const summary = formatToolInput(toolName, toolInput, semantic);

  // AskUserQuestion: user answers come back as "deny" (isError=true), but that's expected behavior
  const showAsError = isError && toolName !== 'AskUserQuestion';

  return (
    <div
      data-testid="tool-use"
      className={`my-2 rounded-xl shadow-apple-sm border ${
        status === 'running'
          ? 'border-primary/30 bg-primary/5'
          : showAsError
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-success/30 bg-success/5'
      }`}
    >
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 active:bg-muted/50 rounded-lg transition-colors"
      >
        {/* Status indicator */}
        {status === 'running' ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : showAsError ? (
          <XCircle size={14} className="text-destructive" />
        ) : (
          <CheckCircle2 size={14} className="text-success" />
        )}

        {/* Tool icon and name */}
        <Icon icon={icon} size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground" data-testid="tool-name">{displayName}</span>

        {/* Summary */}
        <span className="flex-1 text-xs text-muted-foreground truncate ml-2">
          {summary}
        </span>

        {/* Expand/collapse indicator */}
        <span className="text-muted-foreground">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {/* Subagent activity indicator — shows what the Agent is currently doing */}
      {status === 'running' && activity && toolName === 'Agent' && (
        <div className="px-3 pb-2 -mt-1">
          <div className="text-[11px] text-muted-foreground truncate pl-6">
            {activity}
          </div>
        </div>
      )}

      {/* Expanded content — tool-specific rendering */}
      {isExpanded && (
        <ToolExpandedContent
          toolName={toolName}
          toolInput={toolInput}
          status={status}
          result={result}
          isError={isError}
          semantic={semantic}
        />
      )}
    </div>
  );
});

/**
 * Interactive inline answer UI for AskUserQuestion tool calls.
 * Rendered when the tool call is still running (status='running'),
 * allowing the user to answer directly from the tool call card
 * — works on both desktop and mobile/gateway clients.
 */
