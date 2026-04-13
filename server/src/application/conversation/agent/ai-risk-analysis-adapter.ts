/**
 * AIRiskAnalysisPort adapter — wraps evaluateAIReview with a CLI-backed provider.
 *
 * Used by the permission workflow's ai_risk_analysis step to run AI-assisted
 * safety analysis of escalated tool calls.
 */

import { spawn } from 'child_process';
import type { AIRiskAnalysisPort } from '../../../domains/workflows/ports/step-executor.js';
import { evaluateAIReview, type AIReviewProvider } from './delegation-evaluator.js';
import type { AIReviewConfig } from '@my-claudia/shared/interaction/permissions';

/**
 * Creates an AIReviewProvider backed by the Claude CLI.
 * Each call spawns `claude --print` and pipes the prompt via stdin
 * (avoids command-line argument length limits and special character issues).
 */
function createCliReviewProvider(): AIReviewProvider {
  return {
    runPrompt: async (prompt: string, _sessionId?: string): Promise<{ response: string; sessionId?: string }> => {
      return new Promise((resolve, reject) => {
        let settled = false;
        const proc = spawn('claude', [
          '--print',
          '--output-format', 'text',
          '--no-session-persistence',
          '--permission-mode', 'bypassPermissions',
        ], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        // Write prompt via stdin to avoid shell argument limits
        proc.stdin?.write(prompt);
        proc.stdin?.end();

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          proc.kill('SIGTERM');
          reject(new Error('CLI review provider timed out after 60s'));
        }, 60_000);

        proc.on('error', (err) => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          reject(err);
        });

        proc.on('close', (code) => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          if (code !== 0) {
            if (!stdout) {
              reject(new Error(`CLI review provider exited ${code}: ${stderr.slice(0, 200)}`));
            } else {
              console.warn(`[AIRiskAnalysis] CLI exited ${code} with output; stderr: ${stderr.slice(0, 200)}`);
              resolve({ response: stdout });
            }
          } else {
            resolve({ response: stdout });
          }
        });
      });
    },
  };
}

/**
 * AIRiskAnalysisPort implementation that wraps evaluateAIReview()
 * with a CLI-backed AIReviewProvider.
 */
export class AIRiskAnalysisAdapter implements AIRiskAnalysisPort {
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
    const provider = createCliReviewProvider();

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
      analysisProvider: provider,
    });

    return {
      decision: result.decision,
      reasoning: result.reasoning,
      confidence: result.confidence,
      metadata: result.metadata as Record<string, unknown> | undefined,
    };
  }
}
