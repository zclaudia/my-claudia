import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaSensitivityReviewer } from '../local-sensitivity-reviewer';

describe('OllamaSensitivityReviewer', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts pretty-printed JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: `{
  "label": "safe",
  "confidence": 0.91,
  "reason": "Regular source code."
}`,
        },
      }),
    }));

    const reviewer = new OllamaSensitivityReviewer('http://127.0.0.1:11434', 'qwen3:4b-instruct');
    const result = await reviewer.reviewFile({
      path: 'scripts/deploy.sh',
      resolvedPath: '/workspace/scripts/deploy.sh',
      workspaceRoot: '/workspace',
      contentPreview: 'echo deploy',
      commandContext: 'bash scripts/deploy.sh',
    });

    expect(result).toEqual({
      label: 'safe',
      confidence: 0.91,
      reason: 'Regular source code.',
    });
  });

  it('repairs raw newlines inside JSON string values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: `\`\`\`json
{"label":"suspicious","confidence":0.63,"reason":"Potential secret
in config output"}
\`\`\``,
        },
      }),
    }));

    const reviewer = new OllamaSensitivityReviewer('http://127.0.0.1:11434', 'qwen3:4b-instruct');
    const result = await reviewer.reviewFile({
      path: 'config/app.log',
      resolvedPath: '/workspace/config/app.log',
      workspaceRoot: '/workspace',
      contentPreview: 'token=abc123',
      commandContext: 'cat config/app.log',
    });

    expect(result).toEqual({
      label: 'suspicious',
      confidence: 0.63,
      reason: 'Potential secret\nin config output',
    });
  });

  it('throws when no JSON object is present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: 'no structured response',
        },
      }),
    }));

    const reviewer = new OllamaSensitivityReviewer('http://127.0.0.1:11434', 'qwen3:4b-instruct');

    await expect(reviewer.reviewFile({
      path: 'scripts/deploy.sh',
      resolvedPath: '/workspace/scripts/deploy.sh',
      workspaceRoot: '/workspace',
      contentPreview: 'echo deploy',
      commandContext: 'bash scripts/deploy.sh',
    })).rejects.toThrow('Ollama review did not return valid JSON');
  });
});
