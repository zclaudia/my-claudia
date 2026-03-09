import type { SystemInfo } from './claude-sdk.js';

type SubscriptionInfo = NonNullable<SystemInfo['subscription']>;

function buildSubscription(
  provider: string,
  status: SubscriptionInfo['status'],
  summary: string,
): SubscriptionInfo {
  return {
    provider,
    status,
    summary,
    updatedAt: Date.now(),
  };
}

function getEnvValue(name: string, env?: Record<string, string>): string | undefined {
  return env?.[name] || process.env[name];
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 2500,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function sumNumberByKeys(value: unknown, keys: string[]): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return 0;
  if (Array.isArray(value)) return value.reduce((acc, item) => acc + sumNumberByKeys(item, keys), 0);
  if (typeof value === 'object') {
    let sum = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keys.includes(k) && typeof v === 'number' && Number.isFinite(v)) {
        sum += v;
      }
      if (typeof v === 'object' && v !== null) {
        sum += sumNumberByKeys(v, keys);
      }
    }
    return sum;
  }
  return 0;
}

export async function fetchCodexSubscriptionInfo(
  env?: Record<string, string>,
): Promise<SubscriptionInfo> {
  const adminKey = getEnvValue('OPENAI_ADMIN_KEY', env)
    || getEnvValue('OPENAI_API_KEY', env);

  if (!adminKey || !adminKey.startsWith('sk-admin-')) {
    return buildSubscription(
      'codex',
      'requires_admin_key',
      'Usage/cost requires OpenAI Admin API key (OPENAI_ADMIN_KEY).',
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - 30 * 24 * 60 * 60;
  const headers = { Authorization: `Bearer ${adminKey}` };

  try {
    const [usage, costs] = await Promise.all([
      fetchJsonWithTimeout(
        `https://api.openai.com/v1/organization/usage/completions?start_time=${startSec}&end_time=${nowSec}`,
        { headers },
      ),
      fetchJsonWithTimeout(
        `https://api.openai.com/v1/organization/costs?start_time=${startSec}&end_time=${nowSec}`,
        { headers },
      ),
    ]);

    const inputTokens = Math.round(sumNumberByKeys(usage, ['input_tokens', 'prompt_tokens']));
    const outputTokens = Math.round(sumNumberByKeys(usage, ['output_tokens', 'completion_tokens']));
    const usdCost = sumNumberByKeys(costs, ['usd', 'value', 'amount']);

    return buildSubscription(
      'codex',
      'available',
      `Last 30d: in ${inputTokens.toLocaleString()}, out ${outputTokens.toLocaleString()}, cost ~$${usdCost.toFixed(2)}`,
    );
  } catch (error) {
    return buildSubscription(
      'codex',
      'error',
      `Failed to fetch OpenAI org usage/cost: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function fetchClaudeSubscriptionInfo(
  env?: Record<string, string>,
): Promise<SubscriptionInfo> {
  const adminKey = getEnvValue('ANTHROPIC_ADMIN_API_KEY', env);
  if (!adminKey) {
    return buildSubscription(
      'claude',
      'requires_admin_key',
      'Usage/cost requires Anthropic Admin API key (ANTHROPIC_ADMIN_API_KEY).',
    );
  }

  const headers = {
    'x-api-key': adminKey,
    'anthropic-version': '2023-06-01',
  };

  try {
    const [usage, costs] = await Promise.all([
      fetchJsonWithTimeout('https://api.anthropic.com/v1/organizations/usage_report/messages', { headers }),
      fetchJsonWithTimeout('https://api.anthropic.com/v1/organizations/cost_report', { headers }),
    ]);

    const inputTokens = Math.round(sumNumberByKeys(usage, ['input_tokens']));
    const outputTokens = Math.round(sumNumberByKeys(usage, ['output_tokens']));
    const usdCost = sumNumberByKeys(costs, ['usd', 'cost_usd', 'amount']);

    return buildSubscription(
      'claude',
      'available',
      `Org usage: in ${inputTokens.toLocaleString()}, out ${outputTokens.toLocaleString()}, cost ~$${usdCost.toFixed(2)}`,
    );
  } catch (error) {
    return buildSubscription(
      'claude',
      'error',
      `Failed to fetch Anthropic org usage/cost: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getKimiSubscriptionInfoHint(): SubscriptionInfo {
  return buildSubscription(
    'kimi',
    'unavailable',
    'No public management API found. Kimi CLI exposes /usage (/status) on Kimi platform only.',
  );
}
