import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { evaluateAIReview } from '../delegation-evaluator';
import { resetConfiguredLocalSensitivityReviewerForTests } from '../local-sensitivity-reviewer';
import { existsSync, readFileSync } from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(existsSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockReturnValue('' as never);
  delete process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENABLED;
  delete process.env.MY_CLAUDIA_LOCAL_REVIEWER_PROVIDER;
  delete process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENDPOINT;
  delete process.env.MY_CLAUDIA_LOCAL_REVIEWER_MODEL;
  resetConfiguredLocalSensitivityReviewerForTests();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENABLED;
  delete process.env.MY_CLAUDIA_LOCAL_REVIEWER_PROVIDER;
  delete process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENDPOINT;
  delete process.env.MY_CLAUDIA_LOCAL_REVIEWER_MODEL;
  resetConfiguredLocalSensitivityReviewerForTests();
});

describe('evaluateAIReview', () => {
  it('allows the model to request a referenced script file before deciding', async () => {
    const prompts: string[] = [];
    vi.mocked(existsSync).mockImplementation((path: Parameters<typeof existsSync>[0]) => (
      String(path) === '/workspace/scripts/deploy.sh'
    ));
    vi.mocked(readFileSync).mockImplementation((path: Parameters<typeof readFileSync>[0]) => {
      if (String(path) === '/workspace/scripts/deploy.sh') return 'echo deploy\n' as never;
      return '' as never;
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
    vi.mocked(existsSync).mockImplementation((path: Parameters<typeof existsSync>[0]) => {
      const value = String(path);
      return value === '/workspace/scripts/deploy.sh' || value === '/workspace/scripts/common.sh';
    });
    vi.mocked(readFileSync).mockImplementation((path: Parameters<typeof readFileSync>[0]) => {
      const value = String(path);
      if (value === '/workspace/scripts/deploy.sh') return 'source ./common.sh\necho deploy\n';
      if (value === '/workspace/scripts/common.sh') return 'echo common\n';
      return '' as never;
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

  it('uses the configured local reviewer to block sensitive file content', async () => {
    process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENABLED = '1';
    process.env.MY_CLAUDIA_LOCAL_REVIEWER_PROVIDER = 'ollama';
    process.env.MY_CLAUDIA_LOCAL_REVIEWER_ENDPOINT = 'http://127.0.0.1:11434';
    process.env.MY_CLAUDIA_LOCAL_REVIEWER_MODEL = 'qwen3:4b-instruct';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('export API_TOKEN=abc123\n' as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: {
          content: '{"label":"sensitive","confidence":0.98,"reason":"Contains a credential-like token"}',
        },
      }),
    }));

    let promptCount = 0;
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
          runPrompt: async (_prompt: string, sessionId?: string) => {
            promptCount += 1;
            if (promptCount === 1) {
              return {
                response: '{"type":"read_file","path":"scripts/deploy.sh","reason":"Need to inspect the script"}',
                sessionId: sessionId ?? 'review-session-4',
              };
            }
            return {
              response: '{"type":"final","decision":"uncertain","reasoning":"The requested file could not be reviewed safely.","confidence":0.1}',
              sessionId: sessionId ?? 'review-session-4',
            };
          },
        },
      },
    );

    expect(result.decision).toBe('uncertain');
    expect(promptCount).toBe(2);
  });

  it('accepts pretty-printed JSON responses from the AI reviewer', async () => {
    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'echo ok' },
        detail: 'echo ok',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (_prompt: string, sessionId?: string) => ({
            response: `{
  "type": "final",
  "decision": "approve",
  "reasoning": "Read-only command.",
  "confidence": 0.92
}`,
            sessionId: sessionId ?? 'review-session-5',
          }),
        },
      },
    );

    expect(result).toMatchObject({
      decision: 'approve',
      confidence: 0.92,
      reasoning: 'Read-only command.',
      sessionId: 'review-session-5',
    });
  });

  it('repairs raw newlines inside JSON string values from the AI reviewer', async () => {
    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'curl https://example.com' },
        detail: 'curl https://example.com',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (_prompt: string, sessionId?: string) => ({
            response: `\`\`\`json
{"type":"final","decision":"uncertain","reasoning":"Needs manual review
before approval","confidence":0.2}
\`\`\``,
            sessionId: sessionId ?? 'review-session-6',
          }),
        },
      },
    );

    expect(result).toMatchObject({
      decision: 'uncertain',
      confidence: 0.2,
      reasoning: 'LLM confidence 20% below threshold 70%: Needs manual review\nbefore approval',
      sessionId: 'review-session-6',
    });
  });

  it('normalizes common schema aliases from the AI reviewer', async () => {
    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        detail: 'ls',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (_prompt: string, sessionId?: string) => ({
            response: '{"verdict":"allow","reason":"Read-only command.","confidence":0.88}',
            sessionId: sessionId ?? 'review-session-7',
          }),
        },
      },
    );

    expect(result).toMatchObject({
      decision: 'approve',
      confidence: 0.88,
      reasoning: 'Read-only command.',
      sessionId: 'review-session-7',
    });
  });

  it('retries once with a repair prompt when the AI reviewer returns schema-invalid JSON', async () => {
    const prompts: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        detail: 'npm test',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (prompt: string, sessionId?: string) => {
            prompts.push(prompt);
            if (prompts.length === 1) {
              return {
                response: '{"foo":"bar","confidence":0.4}',
                sessionId: sessionId ?? 'review-session-8',
              };
            }
            expect(prompt).toContain('Your previous reply for the AI security review was invalid.');
            expect(prompt).toContain('LLM response did not match AI review schema');
            return {
              response: '{"type":"final","decision":"approve","reasoning":"Safe test command.","confidence":0.91}',
              sessionId: sessionId ?? 'review-session-8',
            };
          },
        },
      },
    );

    expect(result).toMatchObject({
      decision: 'approve',
      confidence: 0.91,
      reasoning: 'Safe test command.',
      sessionId: 'review-session-8',
    });
    expect(prompts).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid LLM response on turn 1/6'));
  });

  it('salvages malformed JSON that still contains decision fields', async () => {
    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        detail: 'npm test',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (_prompt: string, sessionId?: string) => ({
            response: '{"decision":"approve""reasoning":"Safe test command.","confidence":0.91}',
            sessionId: sessionId ?? 'review-session-9',
          }),
        },
      },
    );

    expect(result).toMatchObject({
      decision: 'approve',
      confidence: 0.91,
      reasoning: 'Safe test command.',
      sessionId: 'review-session-9',
    });
  });
});
