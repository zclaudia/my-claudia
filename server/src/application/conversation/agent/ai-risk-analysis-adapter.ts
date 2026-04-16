/**
 * AIRiskAnalysisPort adapter — wraps evaluateAIReview with a provider resolved
 * from configured MyClaudia providers.
 *
 * Used by the permission workflow's ai_risk_analysis step to run AI-assisted
 * safety analysis of escalated tool calls.
 */

import type Database from 'better-sqlite3';
import type { AIRiskAnalysisPort } from '../../../domains/workflows/ports/step-executor.js';
import { evaluateAIReview, type AIReviewProvider } from './delegation-evaluator.js';
import type { AIReviewConfig } from '@my-claudia/shared/interaction/permissions';
import type { ProviderConfig } from '@my-claudia/shared/core/provider';
import type { CliJobInput, CliProviderAdapter, CliJobRawResult, CliAdapterPreparedContext } from '../../../infrastructure/providers/cli-jobs/types.js';
import { runCliJob } from '../../../infrastructure/providers/cli-jobs/runner.js';
import { claudeReviewAdapter } from '../../../infrastructure/providers/cli-jobs/adapters/claude.js';
import { codexReviewAdapter } from '../../../infrastructure/providers/cli-jobs/adapters/codex.js';
import { cursorReviewAdapter } from '../../../infrastructure/providers/cli-jobs/adapters/cursor.js';
import { kimiReviewAdapter } from '../../../infrastructure/providers/cli-jobs/adapters/kimi.js';
import { opencodeReviewAdapter } from '../../../infrastructure/providers/cli-jobs/adapters/opencode.js';

interface ProviderRow {
  id: string;
  name: string;
  type: ProviderConfig['type'];
  cli_path: string | null;
  env: string | null;
  is_default: number;
  created_at: number;
  updated_at: number;
}

const REVIEW_ADAPTERS: Partial<Record<ProviderConfig['type'], CliProviderAdapter>> = {
  claude: claudeReviewAdapter,
  codex: codexReviewAdapter,
  cursor: cursorReviewAdapter,
  kimi: kimiReviewAdapter,
  opencode: opencodeReviewAdapter,
};

function rowToProviderConfig(row: ProviderRow): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    cliPath: row.cli_path || undefined,
    env: row.env ? JSON.parse(row.env) as Record<string, string> : undefined,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createCliReviewProvider(provider: ProviderConfig): AIReviewProvider | undefined {
  const adapter = REVIEW_ADAPTERS[provider.type];
  if (!adapter) return undefined;

  return {
    runPrompt: async (prompt: string, _sessionId?: string): Promise<{ response: string; sessionId?: string }> => {
      const input: CliJobInput = {
        prompt,
        cwd: process.cwd(),
        cliPath: provider.cliPath,
        env: provider.env,
        timeoutMs: 60_000,
      };

      const result = await runCliJob(
        adapter,
        input,
        (assistantText: string, _raw: CliJobRawResult, _ctx?: CliAdapterPreparedContext) => assistantText,
      );

      return { response: result };
    },
  };
}

/**
 * AIRiskAnalysisPort implementation that wraps evaluateAIReview()
 * with a provider resolved from configured providers.
 */
export class AIRiskAnalysisAdapter implements AIRiskAnalysisPort {
  constructor(
    private readonly db: Database.Database,
    private readonly oneShotRuntime?: import('../../oneshot/types.js').OneShotTaskRuntime,
  ) {}

  private resolveProvider(analysisProviderId?: string): ProviderConfig | undefined {
    const row = analysisProviderId
      ? this.db.prepare(`
          SELECT id, name, type, cli_path, env, is_default, created_at, updated_at
          FROM providers
          WHERE id = ?
        `).get(analysisProviderId) as ProviderRow | undefined
      : this.db.prepare(`
          SELECT id, name, type, cli_path, env, is_default, created_at, updated_at
          FROM providers
          WHERE is_default = 1
          ORDER BY updated_at DESC
          LIMIT 1
        `).get() as ProviderRow | undefined;

    return row ? rowToProviderConfig(row) : undefined;
  }

  async evaluate(ctx: {
    toolName: string;
    toolInput: unknown;
    detail: string;
    cwd: string;
    config: {
      confidenceThreshold: number;
      maxAutoApprovalsPerMinute: number;
      analysisProviderId?: string;
    };
  }): Promise<{
    decision: 'approve' | 'deny' | 'uncertain';
    reasoning: string;
    confidence: number;
    metadata?: Record<string, unknown>;
  }> {
    const resolvedProvider = this.resolveProvider(ctx.config.analysisProviderId);
    const reviewProvider = resolvedProvider ? createCliReviewProvider(resolvedProvider) : undefined;

    const config: AIReviewConfig = {
      enabled: true,
      timeoutBeforeReview: 0,
      confidenceThreshold: ctx.config.confidenceThreshold,
      maxAutoApprovalsPerMinute: ctx.config.maxAutoApprovalsPerMinute,
      analysisProviderId: ctx.config.analysisProviderId,
    };

    const result = await evaluateAIReview(config, {
      toolName: ctx.toolName,
      toolInput: ctx.toolInput,
      detail: ctx.detail,
      cwd: ctx.cwd,
      analysisProvider: reviewProvider,
      providerCliPath: resolvedProvider?.cliPath,
      providerEnv: resolvedProvider?.env,
      oneShotRuntime: this.oneShotRuntime,
      providerType: resolvedProvider?.type,
    });

    return {
      decision: result.decision,
      reasoning: result.reasoning,
      confidence: result.confidence,
      metadata: result.metadata as Record<string, unknown> | undefined,
    };
  }
}
