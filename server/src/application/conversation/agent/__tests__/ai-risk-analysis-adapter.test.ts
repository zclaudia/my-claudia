import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { AIRiskAnalysisAdapter } from '../ai-risk-analysis-adapter.js';

const mockEvaluateAIReview = vi.fn();
const mockRunCliJob = vi.fn();

vi.mock('../delegation-evaluator.js', () => ({
  evaluateAIReview: (...args: unknown[]) => mockEvaluateAIReview(...args),
}));

vi.mock('../../../../infrastructure/providers/cli-jobs/runner.js', () => ({
  runCliJob: (...args: unknown[]) => mockRunCliJob(...args),
}));

function createMockDb(rows: {
  byId?: Record<string, Record<string, unknown>>;
  defaultRow?: Record<string, unknown>;
}): Database.Database {
  return {
    prepare: (sql: string) => ({
      get: (value?: string) => {
        if (sql.includes('WHERE id = ?')) {
          return value ? rows.byId?.[value] : undefined;
        }
        if (sql.includes('WHERE is_default = 1')) {
          return rows.defaultRow;
        }
        return undefined;
      },
    }),
  } as unknown as Database.Database;
}

describe('AIRiskAnalysisAdapter', () => {
  beforeEach(() => {
    mockEvaluateAIReview.mockReset();
    mockRunCliJob.mockReset();
    mockRunCliJob.mockResolvedValue('cli review response');
  });

  it('uses the explicitly selected analysis provider for workflow AI review', async () => {
    const db = createMockDb({
      byId: {
        'prov-codex': {
          id: 'prov-codex',
          name: 'Codex Review',
          type: 'codex',
          cli_path: '/custom/codex',
          env: '{"OPENAI_API_KEY":"abc"}',
          is_default: 0,
          created_at: 1,
          updated_at: 2,
        },
      },
    });

    mockEvaluateAIReview.mockImplementation(async (_config, ctx) => {
      const response = await ctx.analysisProvider.runPrompt('review prompt');
      return {
        decision: 'approve',
        reasoning: response.response,
        confidence: 0.91,
      };
    });

    const adapter = new AIRiskAnalysisAdapter(db, { run: vi.fn() } as any);
    const result = await adapter.evaluate({
      toolName: 'Bash',
      toolInput: { command: 'git status' },
      detail: 'Review this command',
      cwd: '/repo',
      config: {
        confidenceThreshold: 0.8,
        maxAutoApprovalsPerMinute: 10,
        analysisProviderId: 'prov-codex',
      },
    });

    expect(result).toMatchObject({
      decision: 'approve',
      reasoning: 'cli review response',
      confidence: 0.91,
    });

    expect(mockEvaluateAIReview).toHaveBeenCalledWith(
      expect.objectContaining({ analysisProviderId: 'prov-codex' }),
      expect.objectContaining({
        providerType: 'codex',
        providerCliPath: '/custom/codex',
        providerEnv: { OPENAI_API_KEY: 'abc' },
      }),
    );

    expect(mockRunCliJob).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: 'codex' }),
      expect.objectContaining({
        prompt: 'review prompt',
        cliPath: '/custom/codex',
        env: { OPENAI_API_KEY: 'abc' },
      }),
      expect.any(Function),
    );
  });

  it('falls back to the default provider when no analysisProviderId is set', async () => {
    const db = createMockDb({
      defaultRow: {
        id: 'prov-default',
        name: 'Default Cursor',
        type: 'cursor',
        cli_path: '/custom/cursor-agent',
        env: '{"CURSOR_TOKEN":"xyz"}',
        is_default: 1,
        created_at: 1,
        updated_at: 2,
      },
    });

    mockEvaluateAIReview.mockResolvedValue({
      decision: 'deny',
      reasoning: 'default provider used',
      confidence: 0.77,
    });

    const adapter = new AIRiskAnalysisAdapter(db, { run: vi.fn() } as any);
    await adapter.evaluate({
      toolName: 'Bash',
      toolInput: { command: 'curl example.com' },
      detail: 'Review this command',
      cwd: '/repo',
      config: {
        confidenceThreshold: 0.8,
        maxAutoApprovalsPerMinute: 10,
      },
    });

    expect(mockEvaluateAIReview).toHaveBeenCalledWith(
      expect.objectContaining({ analysisProviderId: undefined }),
      expect.objectContaining({
        providerType: 'cursor',
        providerCliPath: '/custom/cursor-agent',
        providerEnv: { CURSOR_TOKEN: 'xyz' },
      }),
    );
  });
});
