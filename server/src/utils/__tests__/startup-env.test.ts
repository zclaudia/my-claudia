import { describe, expect, it } from 'vitest';
import { sanitizeInheritedProviderEnv } from '../startup-env.js';

describe('sanitizeInheritedProviderEnv', () => {
  it('removes inherited model selection variables', () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_MODEL: 'MiniMax-M2.5',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'MiniMax-M2.5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M2.5',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M2.5-highspeed',
      OPENAI_MODEL: 'gpt-x',
      MODEL: 'fallback-model',
      CLAUDE_CODE_MODEL: 'opus-4.6',
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'keep-me',
    };

    const result = sanitizeInheritedProviderEnv(env);

    expect(result.removedKeys.sort()).toEqual([
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_MODEL',
      'CLAUDE_CODE_MODEL',
      'MODEL',
      'OPENAI_MODEL',
    ]);
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(env.OPENAI_MODEL).toBeUndefined();
    expect(env.MODEL).toBeUndefined();
    expect(env.CLAUDE_CODE_MODEL).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.ANTHROPIC_API_KEY).toBe('keep-me');
  });

  it('is a no-op when no model vars are present', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
    };

    const result = sanitizeInheritedProviderEnv(env);

    expect(result.removedKeys).toEqual([]);
    expect(env.PATH).toBe('/usr/bin');
  });
});
