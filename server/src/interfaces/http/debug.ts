import { Router, type Request, type Response } from 'express';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { getCrashLogFilePath, readCrashReports } from '../../utils/crash-log.js';
import type { ProcessSupervisor, ManagedProcessRecord } from '../../infrastructure/services/process-supervisor.js';
import { evaluateAIReview } from '../../application/conversation/agent/delegation-evaluator.js';
import { supportsAIReviewCliJob, runAIReviewCliJob } from '../../infrastructure/providers/cli-jobs/review-job.js';
import { CliReviewParseError } from '../../infrastructure/providers/cli-jobs/review-parser.js';
import { DEFAULT_AI_REVIEW_CONFIG } from '@my-claudia/shared/interaction/permissions';
import type Database from 'better-sqlite3';

export interface PermissionLogEntry {
  id: string;
  session_id: string;
  tool: string;
  detail: string;
  decision: 'allow' | 'deny';
  remembered: number;
  created_at: number;
}

export function createDebugRoutes(processSupervisor?: ProcessSupervisor, db?: Database.Database): Router {
  const router = Router();

  router.get('/crashes', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        reports: readCrashReports(20),
        filePath: getCrashLogFilePath(),
      },
    } satisfies ApiResponse<{ reports: ReturnType<typeof readCrashReports>; filePath: string }>);
  });

  router.get('/processes', (_req: Request, res: Response) => {
    if (!processSupervisor) {
      res.json({
        success: true,
        data: [],
      } satisfies ApiResponse<ManagedProcessRecord[]>);
      return;
    }

    res.json({
      success: true,
      data: processSupervisor.listProcesses(),
    } satisfies ApiResponse<ManagedProcessRecord[]>);
  });

  router.get('/processes/:processId', (req: Request, res: Response) => {
    if (!processSupervisor) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Process supervisor unavailable' },
      } satisfies ApiResponse<never>);
      return;
    }

    const record = processSupervisor.getProcess(req.params.processId);
    if (!record) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Managed process not found' },
      } satisfies ApiResponse<never>);
      return;
    }

    res.json({
      success: true,
      data: record,
    } satisfies ApiResponse<ManagedProcessRecord>);
  });

  router.get('/permission-logs', (req: Request, res: Response) => {
    if (!db) {
      res.json({
        success: true,
        data: { entries: [], total: 0 },
      } satisfies ApiResponse<{ entries: PermissionLogEntry[]; total: number }>);
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const sessionId = req.query.session_id as string | undefined;
    const decision = req.query.decision as string | undefined;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (sessionId) {
      conditions.push('session_id = ?');
      params.push(sessionId);
    }
    if (decision && ['allow', 'deny'].includes(decision)) {
      conditions.push('decision = ?');
      params.push(decision);
    }

    const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    const total = (db.prepare(`SELECT COUNT(*) as total FROM permission_logs${where}`).get(...params) as { total: number }).total;
    const entries = db.prepare(`SELECT * FROM permission_logs${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as PermissionLogEntry[];

    res.json({
      success: true,
      data: { entries, total },
    } satisfies ApiResponse<{ entries: PermissionLogEntry[]; total: number }>);
  });

  router.post('/simulate-ai-review', async (req: Request, res: Response) => {
    const {
      toolName,
      toolInput,
      detail,
      cwd,
      providerId,
      confidenceThreshold,
      mode = 'quick',
    } = req.body as {
      toolName?: string;
      toolInput?: unknown;
      detail?: string;
      cwd?: string;
      providerId?: string;
      confidenceThreshold?: number;
      mode?: 'quick' | 'full';
    };

    if (!toolName || !detail || !cwd) {
      res.status(400).json({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'toolName, detail, and cwd are required' },
      } satisfies ApiResponse<never>);
      return;
    }

    if (!db) {
      res.status(500).json({
        success: false,
        error: { code: 'NO_DB', message: 'Database not available' },
      } satisfies ApiResponse<never>);
      return;
    }

    // Find provider
    let resolvedProviderId = providerId;
    if (!resolvedProviderId) {
      const firstProvider = db.prepare(
        `SELECT id FROM providers WHERE type IN ('claude', 'kimi', 'cursor', 'opencode', 'codex') LIMIT 1`
      ).get() as { id: string } | undefined;
      resolvedProviderId = firstProvider?.id;
    }

    if (!resolvedProviderId) {
      res.status(400).json({
        success: false,
        error: { code: 'NO_PROVIDER', message: 'No AI review-capable provider found' },
      } satisfies ApiResponse<never>);
      return;
    }

    const providerRow = db.prepare(
      `SELECT id, type, cli_path as cliPath, env FROM providers WHERE id = ?`
    ).get(resolvedProviderId) as {
      id: string;
      type: string;
      cliPath: string | null;
      env: string | null;
    } | undefined;

    if (!providerRow || !supportsAIReviewCliJob(providerRow.type)) {
      res.status(400).json({
        success: false,
        error: { code: 'UNSUPPORTED_PROVIDER', message: `Provider ${resolvedProviderId} does not support AI review` },
      } satisfies ApiResponse<never>);
      return;
    }

    const providerEnv = parseProviderEnv(providerRow.env, providerRow.id);
    const systemPrompt = 'You are a machine-only security review helper for a coding assistant. Follow the user prompt exactly. Do not add markdown, commentary, prose, or code fences. Return only the JSON object requested by the prompt.';

    const startTime = Date.now();
    try {
      if (mode === 'full') {
        // Full mode: use evaluateAIReview with multi-turn file reading
        const config = {
          ...DEFAULT_AI_REVIEW_CONFIG,
          confidenceThreshold: confidenceThreshold ?? DEFAULT_AI_REVIEW_CONFIG.confidenceThreshold,
        };
        const result = await evaluateAIReview(config, {
          toolName,
          toolInput: toolInput ?? { command: detail },
          detail,
          cwd,
          analysisProvider: {
            runPrompt: async (prompt: string) => {
              try {
                const jobResult = await runAIReviewCliJob(providerRow.type, {
                  prompt,
                  cwd,
                  cliPath: providerRow.cliPath ?? undefined,
                  env: providerEnv,
                  systemPrompt,
                  timeoutMs: 120000,
                });
                return {
                  response: JSON.stringify({
                    type: 'final',
                    decision: jobResult.decision,
                    reasoning: jobResult.reasoning,
                    confidence: jobResult.confidence,
                  }),
                };
              } catch (err) {
                if (err instanceof CliReviewParseError && err.rawAssistantText) {
                  return { response: err.rawAssistantText };
                }
                throw err;
              }
            },
          },
        });
        res.json({
          success: true,
          data: {
            decision: result.decision,
            reasoning: result.reasoning,
            confidence: result.confidence,
            metadata: result.metadata,
            durationMs: Date.now() - startTime,
            providerId: providerRow.id,
            providerType: providerRow.type,
            mode: 'full',
          },
        });
      } else {
        // Quick mode: same evaluateAIReview pipeline but skip rate-limit and threshold
        const config = {
          ...DEFAULT_AI_REVIEW_CONFIG,
          confidenceThreshold: 0,
          maxAutoApprovalsPerMinute: 9999,
        };
        const result = await evaluateAIReview(config, {
          toolName,
          toolInput: toolInput ?? { command: detail },
          detail,
          cwd,
          analysisProvider: {
            runPrompt: async (prompt: string) => {
              try {
                const jobResult = await runAIReviewCliJob(providerRow.type, {
                  prompt,
                  cwd,
                  cliPath: providerRow.cliPath ?? undefined,
                  env: providerEnv,
                  systemPrompt,
                  timeoutMs: 120000,
                });
                return {
                  response: JSON.stringify({
                    type: 'final',
                    decision: jobResult.decision,
                    reasoning: jobResult.reasoning,
                    confidence: jobResult.confidence,
                  }),
                };
              } catch (err) {
                if (err instanceof CliReviewParseError && err.rawAssistantText) {
                  return { response: err.rawAssistantText };
                }
                throw err;
              }
            },
          },
        });
        res.json({
          success: true,
          data: {
            decision: result.decision,
            reasoning: result.reasoning,
            confidence: result.confidence,
            metadata: result.metadata,
            durationMs: Date.now() - startTime,
            providerId: providerRow.id,
            providerType: providerRow.type,
            mode: 'quick',
          },
        });
      }
    } catch (err) {
      res.status(500).json({
        success: false,
        error: {
          code: 'REVIEW_FAILED',
          message: err instanceof Error ? err.message : 'AI review simulation failed',
        },
      } satisfies ApiResponse<never>);
    }
  });

  return router;
}

function parseProviderEnv(envJson: string | null, providerId: string): Record<string, string> {
  if (!envJson) return {};
  try {
    const parsed = JSON.parse(envJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)])
    );
  } catch {
    console.warn(`[Debug] Failed to parse provider env for ${providerId}`);
    return {};
  }
}

