import { describe, it, expect, vi, afterEach } from 'vitest';
import { evaluateAIReview } from '../delegation-evaluator';
import * as fs from 'fs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('evaluateAIReview', () => {
  it('allows the model to request a referenced script file before deciding', async () => {
    const prompts: string[] = [];
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('echo deploy\n');

    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'bash scripts/deploy.sh' },
        detail: 'bash scripts/deploy.sh',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (prompt: string, sessionId?: string) => {
            prompts.push(prompt);
            if (prompts.length === 1) {
              expect(prompt).toContain('scripts/deploy.sh');
              return {
                response: '{"type":"read_file","path":"scripts/deploy.sh","reason":"Need to inspect the script"}',
                sessionId: sessionId ?? 'review-session-1',
              };
            }
            expect(prompt).toContain('<file_content path="scripts/deploy.sh">');
            expect(prompt).toContain('echo deploy');
            return {
              response: '{"type":"final","decision":"approve","reasoning":"The script only echoes a deploy message.","confidence":0.93}',
              sessionId: sessionId ?? 'review-session-1',
            };
          },
        },
      },
    );

    expect(result.decision).toBe('approve');
    expect(result.sessionId).toBe('review-session-1');
    expect(prompts).toHaveLength(2);
  });

  it('denies access to sensitive files even when the model requests them', async () => {
    const prompts: string[] = [];

    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'bash .env' },
        detail: 'bash .env',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (prompt: string, sessionId?: string) => {
            prompts.push(prompt);
            if (prompts.length === 1) {
              return {
                response: '{"type":"read_file","path":".env","reason":"Need to inspect env file"}',
                sessionId: sessionId ?? 'review-session-2',
              };
            }
            expect(prompt).toContain('<status>denied</status>');
            return {
              response: '{"type":"final","decision":"uncertain","reasoning":"The requested file could not be reviewed safely.","confidence":0.2}',
              sessionId: sessionId ?? 'review-session-2',
            };
          },
        },
      },
    );

    expect(result.decision).toBe('uncertain');
    expect(prompts).toHaveLength(2);
  });

  it('includes one layer of local script dependencies in the reviewable file list', async () => {
    const prompts: string[] = [];
    vi.spyOn(fs, 'existsSync').mockImplementation((path: fs.PathLike) => {
      const value = String(path);
      return value === '/workspace/scripts/deploy.sh' || value === '/workspace/scripts/common.sh';
    });
    vi.spyOn(fs, 'readFileSync').mockImplementation((path: fs.PathOrFileDescriptor) => {
      const value = String(path);
      if (value === '/workspace/scripts/deploy.sh') return 'source ./common.sh\necho deploy\n';
      if (value === '/workspace/scripts/common.sh') return 'echo common\n';
      return '';
    });

    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'bash scripts/deploy.sh' },
        detail: 'bash scripts/deploy.sh',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (prompt: string, sessionId?: string) => {
            prompts.push(prompt);
            if (prompts.length === 1) {
              expect(prompt).toContain('scripts/deploy.sh');
              expect(prompt).toContain('./common.sh (dependency)');
              return {
                response: '{"type":"read_file","path":"./common.sh","reason":"Need to inspect sourced helper"}',
                sessionId: sessionId ?? 'review-session-3',
              };
            }
            expect(prompt).toContain('<file_content path="./common.sh">');
            expect(prompt).toContain('echo common');
            return {
              response: '{"type":"final","decision":"approve","reasoning":"The helper script is benign.","confidence":0.91}',
              sessionId: sessionId ?? 'review-session-3',
            };
          },
        },
      },
    );

    expect(result.decision).toBe('approve');
    expect(prompts).toHaveLength(2);
  });
}
