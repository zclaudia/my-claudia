const INHERITED_PROVIDER_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'OPENAI_MODEL',
  'MODEL',
  'CLAUDE_MODEL',
  'CLAUDE_CODE_MODEL',
  'CODEX_MODEL',
  'CURSOR_MODEL',
  'KIMI_MODEL',
  'MINIMAX_MODEL',
  'MOONSHOT_MODEL',
] as const;

export interface SanitizedEnvResult {
  removedKeys: string[];
}

/**
 * Drop model-selection env vars inherited from the parent shell/session.
 * Provider-specific credentials are intentionally preserved here; providers may
 * still rely on them when no explicit per-provider env override is configured.
 */
export function sanitizeInheritedProviderEnv(
  env: NodeJS.ProcessEnv = process.env,
): SanitizedEnvResult {
  const removedKeys: string[] = [];

  for (const key of INHERITED_PROVIDER_ENV_KEYS) {
    if (env[key] !== undefined) {
      delete env[key];
      removedKeys.push(key);
    }
  }

  return { removedKeys };
}

export { INHERITED_PROVIDER_ENV_KEYS };
