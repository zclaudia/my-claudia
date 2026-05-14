// Provider Policy
// MyClaudia-specific runtime policy for handling provider differences.

/**
 * Auth-related error hint: when a raw provider error matches one of these
 * patterns the runtime rewrites the message to point the user at the correct
 * re-auth flow.
 */
export interface ProviderAuthErrorHint {
  matchAny: Array<string | string[]>;
  message: string;
}

export interface ProviderPolicy {
  /**
   * Interaction tool IDs that this provider supports natively.
   * Tools listed here will not be injected through the bridge.
   */
  nativeInteractionTools?: string[];

  /**
   * Message the runtime should inject if a tool-driven turn completes without
   * visible assistant text.
   */
  emptyResultFallback?: string;

  /**
   * Working-directory policy when resuming a persisted session.
   */
  sessionCwdPolicy?: 'pinned' | 'requested';

  /**
   * Whether a provider-side session can be resumed when the next turn starts
   * in a non-default mode.
   */
  modeSwitchSessionPolicy?: 'reset' | 'preserve';

  /**
   * Provider-specific auth error rewrite hint.
   */
  authErrorHint?: ProviderAuthErrorHint;

  /**
   * Tool names this provider produces that must always escalate to the user.
   */
  escalateAlwaysTools?: string[];
}
