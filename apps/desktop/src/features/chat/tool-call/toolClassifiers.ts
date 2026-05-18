import type { ToolSemantic } from '@my-claudia/shared';

function hasInteractionToolSuffix(toolName: string, suffix: string): boolean {
  return toolName === suffix
    || toolName.endsWith(`_${suffix}`)
    || toolName.endsWith(`-${suffix}`)
    || toolName.endsWith(`:${suffix}`);
}

function normalizeToolName(toolName: string): string {
  return toolName.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Check if tool is a todo-list tool (built-in TodoWrite or MCP update_todo_list)
function isTodoTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return toolName === 'TodoWrite'
    || hasInteractionToolSuffix(toolName, 'update_todo_list')
    || normalized === 'updatetodos'
    || normalized === 'todolist'
    || normalized === 'todolistwrite';
}

// Check if tool is an ask_user_form tool (MCP)
function isAskUserFormTool(toolName: string): boolean {
  return hasInteractionToolSuffix(toolName, 'ask_user_form');
}

// Check if tool is a request_approval tool (MCP)
function isApprovalTool(toolName: string): boolean {
  return hasInteractionToolSuffix(toolName, 'request_approval');
}

function isAskUserQuestionTool(toolName: string): boolean {
  return toolName === 'AskUserQuestion';
}

// Check if tool is a push_file tool (MCP)
function isPushFileTool(toolName: string): boolean {
  return hasInteractionToolSuffix(toolName, 'push_file');
}

// Whether a tool participates in plan-mode UX. The provider SDK is the source
// of truth — it tags its native plan tools with `toolSemantic`. We fall back to
// MCP-bridge suffix detection for providers that don't speak the semantic yet
// (i.e. the `claudia-plugins` enter/exit_plan_mode bridge).
function isPlanModeTool(toolName: string, semantic?: ToolSemantic): boolean {
  if (semantic === 'plan_enter' || semantic === 'plan_exit' || semantic === 'plan_proposal') {
    return true;
  }
  return hasInteractionToolSuffix(toolName, 'enter_plan_mode')
    || hasInteractionToolSuffix(toolName, 'exit_plan_mode');
}

// Whether a tool carries a plan proposal that should be rendered as a plan
// card. Driven by the shared `toolSemantic` so the UI does not need to know
// provider-specific names like `ExitPlanMode` or `createPlan`.
function isPlanProposalTool(toolName: string, semantic?: ToolSemantic): boolean {
  if (semantic === 'plan_proposal') return true;
  return hasInteractionToolSuffix(toolName, 'exit_plan_mode');
}

// Check if tool is any MCP interaction tool
function isInteractionTool(toolName: string, semantic?: ToolSemantic): boolean {
  return isTodoTool(toolName)
    || isAskUserFormTool(toolName)
    || isAskUserQuestionTool(toolName)
    || isApprovalTool(toolName)
    || isPushFileTool(toolName)
    || isPlanModeTool(toolName, semantic);
}

export {
  hasInteractionToolSuffix,
  normalizeToolName,
  isTodoTool,
  isAskUserFormTool,
  isApprovalTool,
  isAskUserQuestionTool,
  isPushFileTool,
  isPlanModeTool,
  isPlanProposalTool,
  isInteractionTool,
};
