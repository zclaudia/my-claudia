export type LocalSensitivityLabel = 'safe' | 'suspicious' | 'sensitive';

export interface LocalSensitivityReviewInput {
  path: string;
  resolvedPath: string;
  workspaceRoot: string;
  contentPreview: string;
  commandContext: string;
}

export interface LocalSensitivityReviewResult {
  label: LocalSensitivityLabel;
  confidence: number;
  reason: string;
}

export interface LocalSensitivityReviewer {
  reviewFile(input: LocalSensitivityReviewInput): Promise<LocalSensitivityReviewResult>;
}

export interface ConfiguredLocalReviewerInfo {
  enabled: boolean;
  provider?: string;
  endpoint?: string;
  model?: string;
  serverReachable: boolean;
  modelAvailable: boolean;
  lastError?: string;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

const REVIEW_PROMPT = `You classify whether a file preview is safe to send to a remote AI security reviewer.

Return ONLY one JSON object:
{"label":"safe"|"suspicious"|"sensitive","confidence":0.0,"reason":"short reason"}

Rules:
- "sensitive" for secrets, credentials, private keys, tokens, cookies, personal data exports, or clearly confidential operational data.
- "suspicious" for config files or logs that may contain secrets or private information, even if uncertain.
- "safe" for ordinary source code, tests, build scripts, and docs with no obvious sensitive content.
- Be conservative: if unsure between safe and suspicious, choose suspicious.`;

export class OllamaSensitivityReviewer implements LocalSensitivityReviewer {
  constructor(
    private readonly endpoint: string,
    private readonly model: string,
  ) {}

  async reviewFile(input: LocalSensitivityReviewInput): Promise<LocalSensitivityReviewResult> {
    const response = await fetch(`${this.endpoint.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        options: {
          temperature: 0,
        },
        messages: [
          {
            role: 'system',
            content: REVIEW_PROMPT,
          },
          {
            role: 'user',
            content: `<file>
<path>${input.path}</path>
<resolved_path>${input.resolvedPath}</resolved_path>
<workspace_root>${input.workspaceRoot}</workspace_root>
<command_context>${input.commandContext.slice(0, 500)}</command_context>
</file>

<preview>
${input.contentPreview.slice(0, 8000)}
</preview>`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama review failed (${response.status})`);
    }

    const payload = await response.json() as OllamaChatResponse;
    const content = payload.message?.content;
    if (!content) {
      throw new Error('Ollama review returned empty content');
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Ollama review did not return valid JSON');
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const label = parsed.label === 'sensitive'
      ? 'sensitive'
      : parsed.label === 'suspicious'
        ? 'suspicious'
        : 'safe';

    return {
      label,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
    };
  }
}

let cachedReviewer: LocalSensitivityReviewer | null | undefined;

async function probeOllamaStatus(endpoint: string, model: string): Promise<ConfiguredLocalReviewerInfo> {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/api/tags`);
    if (!response.ok) {
      return {
        enabled: true,
        provider: 'ollama',
        endpoint,
        model,
        serverReachable: false,
        modelAvailable: false,
        lastError: `Ollama probe failed (${response.status})`,
      };
    }

    const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const modelAvailable = !!payload.models?.some((entry) => entry.name === model || entry.model === model);
    return {
      enabled: true,
      provider: 'ollama',
      endpoint,
      model,
      serverReachable: true,
      modelAvailable,
      lastError: modelAvailable ? undefined : `Model ${model} is not installed`,
    };
  } catch (error) {
    return {
      enabled: true,
      provider: 'ollama',
      endpoint,
      model,
      serverReachable: false,
      modelAvailable: false,
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getConfiguredLocalSensitivityReviewer(): LocalSensitivityReviewer | null {
  if (cachedReviewer !== undefined) return cachedReviewer;

  if (process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENABLED !== '1') {
    cachedReviewer = null;
    return cachedReviewer;
  }

  const provider = process.env.MY_CLAUDIA_LOCAL_REVIEWER_PROVIDER || 'ollama';
  const endpoint = process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENDPOINT || 'http://127.0.0.1:11434';
  const model = process.env.MY_CLAUDIA_LOCAL_REVIEWER_MODEL || 'qwen3:4b-instruct';

  cachedReviewer = provider === 'ollama'
    ? new OllamaSensitivityReviewer(endpoint, model)
    : null;

  return cachedReviewer;
}

export function resetConfiguredLocalSensitivityReviewerForTests(): void {
  cachedReviewer = undefined;
}

export async function getConfiguredLocalSensitivityReviewerInfo(): Promise<ConfiguredLocalReviewerInfo> {
  if (process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENABLED !== '1') {
    return {
      enabled: false,
      provider: process.env.MY_CLAUDIA_LOCAL_REVIEWER_PROVIDER || 'ollama',
      endpoint: process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENDPOINT || 'http://127.0.0.1:11434',
      model: process.env.MY_CLAUDIA_LOCAL_REVIEWER_MODEL || 'qwen3:4b-instruct',
      serverReachable: false,
      modelAvailable: false,
    };
  }

  const provider = process.env.MY_CLAUDIA_LOCAL_REVIEWER_PROVIDER || 'ollama';
  const endpoint = process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENDPOINT || 'http://127.0.0.1:11434';
  const model = process.env.MY_CLAUDIA_LOCAL_REVIEWER_MODEL || 'qwen3:4b-instruct';

  if (provider === 'ollama') {
    return probeOllamaStatus(endpoint, model);
  }

  return {
    enabled: true,
    provider,
    endpoint,
    model,
    serverReachable: false,
    modelAvailable: false,
    lastError: `Unsupported local reviewer provider: ${provider}`,
  };
}
