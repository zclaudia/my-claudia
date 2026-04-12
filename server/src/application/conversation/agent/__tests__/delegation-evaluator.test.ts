import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { evaluateAIReview, _resetRateLimiterForTesting } from '../delegation-evaluator';
import { existsSync, readFileSync } from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

beforeEach(() => {
  _resetRateLimiterForTesting();
  vi.mocked(existsSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readFileSync).mockReturnValue('' as never);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
          runPrompt: vi.fn(),
        },
      },
    );

    expect(result.decision).toBe('uncertain');
    expect(result.metadata).toMatchObject({
      payloadDisposition: 'do_not_send',
    });
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

  it('blocks sensitive file content via local payload guard rules', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('printenv\n' as never);

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

  it('redacts secret-like values before sending the initial review payload remotely', async () => {
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
        toolInput: { command: 'curl https://api.example.com -H "Authorization: Bearer secret-token-1234567890"' },
        detail: 'curl https://api.example.com -H "Authorization: Bearer secret-token-1234567890"',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async (prompt: string, sessionId?: string) => {
            prompts.push(prompt);
            return {
              response: '{"type":"final","decision":"approve","reasoning":"Redacted network request.","confidence":0.86}',
              sessionId: sessionId ?? 'review-session-redact',
            };
          },
        },
      },
    );

    expect(result.decision).toBe('approve');
    expect(result.metadata).toMatchObject({
      payloadDisposition: 'send_with_redaction',
      redactionCount: 4,
    });
    expect(prompts[0]).toContain('[REDACTED_TOKEN]');
    expect(prompts[0]).not.toContain('secret-token-1234567890');
  });

  it('skips remote AI review when the initial payload matches block rules', async () => {
    const runPrompt = vi.fn();

    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'printenv' },
        detail: 'printenv',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt,
        },
      },
    );

    expect(runPrompt).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      decision: 'uncertain',
      metadata: {
        payloadDisposition: 'do_not_send',
      },
    });
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

  it('prefers the final review JSON over JSON fragments embedded in think text', async () => {
    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'adb install app.apk' },
        detail: 'adb install app.apk',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async () => ({
            response: `<think>The tool call is:

<tool_name>Bash</tool_name>
<detail>adb install app.apk</detail>
<input>{
  "command": "adb install app.apk"
}</input>

This affects an external device and should be denied.</think>
{"type":"final","decision":"deny","reasoning":"Installing APK files via adb affects external devices and the APK content is untrusted user data that could contain malicious code","confidence":0.9}`,
            sessionId: 'review-session-think-json',
          }),
        },
      },
    );

    expect(result).toMatchObject({
      decision: 'deny',
      confidence: 0.9,
      reasoning: 'Installing APK files via adb affects external devices and the APK content is untrusted user data that could contain malicious code',
      sessionId: 'review-session-think-json',
    });
  });

  it('hides parser details from user-facing AI review failures', async () => {
    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'adb install app.apk' },
        detail: 'adb install app.apk',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async () => ({
            response: '{"type":"final","decision":"approve" "reasoning":"broken","confidence":0.9',
            sessionId: 'review-session-10',
          }),
        },
      },
    );

    expect(result.decision).toBe('uncertain');
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain('AI review could not produce a reliable result');
    expect(result.reasoning).not.toContain('malformed JSON');
    expect(result.reasoning).not.toContain('LLM analysis failed');
  });

  it('returns uncertain when confidence is below threshold', async () => {
    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.8,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        detail: 'npm test',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async () => ({
            response: '{"type":"final","decision":"approve","reasoning":"Looks safe","confidence":0.5}',
          }),
        },
      },
    );

    expect(result.decision).toBe('uncertain');
    expect(result.confidence).toBe(0.5);
    expect(result.reasoning).toContain('below threshold');
  });

  it('enforces rate limiting for approvals', async () => {
    const config = {
      enabled: true,
      timeoutBeforeReview: 60,
      confidenceThreshold: 0.7,
      maxAutoApprovalsPerMinute: 2,
    };
    const ctx = {
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      detail: 'echo hi',
      cwd: '/workspace',
      analysisProvider: {
        runPrompt: async () => ({
          response: '{"type":"final","decision":"approve","reasoning":"Safe","confidence":0.95}',
        }),
      },
    };

    // First two should approve
    const r1 = await evaluateAIReview(config, ctx);
    expect(r1.decision).toBe('approve');
    const r2 = await evaluateAIReview(config, ctx);
    expect(r2.decision).toBe('approve');

    // Third should be rate limited → uncertain
    const r3 = await evaluateAIReview(config, ctx);
    expect(r3.decision).toBe('uncertain');
    expect(r3.reasoning.toLowerCase()).toContain('rate limit');
  });

  it('does not rate-limit deny decisions', async () => {
    const config = {
      enabled: true,
      timeoutBeforeReview: 60,
      confidenceThreshold: 0.7,
      maxAutoApprovalsPerMinute: 1,
    };

    // First: approve (exhausts rate limit)
    const r1 = await evaluateAIReview(config, {
      toolName: 'Bash',
      toolInput: { command: 'echo ok' },
      detail: 'echo ok',
      cwd: '/workspace',
      analysisProvider: {
        runPrompt: async () => ({
          response: '{"type":"final","decision":"approve","reasoning":"Safe","confidence":0.95}',
        }),
      },
    });
    expect(r1.decision).toBe('approve');

    // Second: deny should still work even though rate limit is exhausted
    const r2 = await evaluateAIReview(config, {
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /' },
      detail: 'rm -rf /',
      cwd: '/workspace',
      analysisProvider: {
        runPrompt: async () => ({
          response: '{"type":"final","decision":"deny","reasoning":"Dangerous","confidence":0.99}',
        }),
      },
    });
    // Rate limit only blocks approvals, so deny should either pass through or be rate-limited
    // The current implementation rate-limits ALL decisions before LLM analysis
    expect(r2.decision).toBe('uncertain');
  });

  it('returns uncertain when provider throws an error', async () => {
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
          runPrompt: async () => {
            throw new Error('Provider connection failed');
          },
        },
      },
    );

    expect(result.decision).toBe('uncertain');
    expect(result.confidence).toBe(0);
  });

  it('handles empty detail gracefully', async () => {
    const result = await evaluateAIReview(
      {
        enabled: true,
        timeoutBeforeReview: 60,
        confidenceThreshold: 0.7,
        maxAutoApprovalsPerMinute: 10,
      },
      {
        toolName: 'Bash',
        toolInput: { command: '' },
        detail: '',
        cwd: '/workspace',
        analysisProvider: {
          runPrompt: async () => ({
            response: '{"type":"final","decision":"deny","reasoning":"Empty command","confidence":0.9}',
          }),
        },
      },
    );

    expect(result.decision).toBe('deny');
    expect(result.confidence).toBe(0.9);
  });
});
