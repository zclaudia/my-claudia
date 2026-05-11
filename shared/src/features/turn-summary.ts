/**
 * Per-turn AI summary of a session conversation.
 *
 * A "turn" is the message range `[user_message_id, next_user_message_id)`.
 * Once the next user message is committed, the turn is finalised and its
 * summary can be cached permanently. A summary's `asOfMessageId` records the
 * last message that was in the turn at generation time — clients compare it
 * to the current last-message-in-turn to detect staleness.
 */
export interface TurnSummary {
  sessionId: string;
  /** Anchor — the user message that opens this turn. */
  userMessageId: string;
  /** Last message id in the turn at generation time; used for staleness checks. */
  asOfMessageId: string;
  /** 1-2 sentences: what the user asked the agent to do. */
  goal: string;
  /** 2-3 sentences: what was actually accomplished. */
  solved: string;
  /** 1-2 sentences: what remains unsolved, failed, or pending; "—" if nothing. */
  openIssues: string;
  /** Model id used to generate this summary (e.g. "claude-haiku-4-5"). */
  model: string;
  /** Epoch ms. */
  generatedAt: number;
}

/** Request body for the generate endpoint. */
export interface GenerateTurnSummaryRequest {
  /** Optional model override. If omitted, server chooses a default. */
  model?: string;
  /** If true, regenerate even when an unchanged cached summary exists. */
  force?: boolean;
}

export interface GenerateTurnSummaryResponse {
  summary: TurnSummary;
  /** true if the returned summary came from cache, false if freshly generated. */
  fromCache: boolean;
}
