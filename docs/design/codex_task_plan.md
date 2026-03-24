# Codex Provider: AI-Initiated Plan Mode (方案B)

## Status: Implementation Complete ✅

All phases implemented and type-checked successfully.

## Changes Made

### Phase 1: Shared Types ✅
- `shared/src/interaction/forms.ts` — Added `PlanReviewInteractionMessage` interface
- `shared/src/protocol/messages/index.ts` — Added to `ServerMessage` union + import

### Phase 2: Interaction Tools ✅
- `server/src/interactions/interaction-tools.ts` — Registered `enter_plan_mode` (fire-and-forget) and `exit_plan_mode` (blocking via `dispatchAndWait`)

### Phase 3: Tool Name Normalization ✅
- `server/src/providers/codex-sdk.ts` — Added `normalizeMcpToolName()` + `MCP_PLAN_TOOL_MAP` to map `enter_plan_mode`→`EnterPlanMode`, `exit_plan_mode`→`ExitPlanMode`

### Phase 4: Run Handler ✅
- `server/src/ws/run-handler.ts` — Extended provider check from `'claude'` to `'claude' || 'codex'` for plan mode state sync

### Phase 5: System Prompt ✅
- `server/src/ws/run-handler.ts` — Added plan mode tool descriptions to interaction tool prompt

### Phase 6: Client UI ✅
- `apps/desktop/src/components/chat/InteractionItem.tsx` — Added `PlanReviewRenderer` with plan markdown display, expand/collapse, deny+comment, approve
- `apps/desktop/src/services/messageHandler.ts` — Added `interaction_plan_review` case
- `apps/desktop/src/components/chat/ToolCallItem.tsx` — Added `isPlanModeTool()` + routing to InteractionItem
