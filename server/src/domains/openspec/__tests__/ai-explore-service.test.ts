// server/src/domains/openspec/__tests__/ai-explore-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  AiExploreService,
  buildExplorePrompt,
  parseExploreResponse,
} from '../ai-explore-service.js';

describe('buildExplorePrompt', () => {
  it('initial mode does not include corpus block', () => {
    const p = buildExplorePrompt({ projectId: 'p1', workingDirectory: '/tmp/x', mode: 'initial' });
    expect(p).toContain('bootstrapping a project specification corpus');
    expect(p).not.toContain('Existing corpus summary');
  });

  it('rescan mode includes corpus block when summary provided', () => {
    const p = buildExplorePrompt({
      projectId: 'p1',
      workingDirectory: '/tmp/x',
      mode: 'rescan',
      existingCorpusSummary: 'EXISTING',
    });
    expect(p).toContain('re-scanning');
    expect(p).toContain('EXISTING');
  });

  it('contains output-format JSON schema example', () => {
    const p = buildExplorePrompt({ projectId: 'p1', workingDirectory: '/tmp/x', mode: 'initial' });
    expect(p).toMatch(/perCapability/);
    expect(p).toMatch(/added/);
    expect(p).toMatch(/modified/);
    expect(p).toMatch(/removed/);
  });
});

describe('parseExploreResponse', () => {
  it('parses a well-formed AI response into perCapability map', () => {
    const raw = `Here is the analysis:\n\n\`\`\`json\n${JSON.stringify({
      perCapability: {
        auth: {
          added: [
            {
              name: 'Login',
              body: 'System MUST authenticate users.',
              scenarios: [
                { name: 'Valid creds', bodyLines: ['- **WHEN** valid', '- **THEN** SHALL return token'] },
              ],
            },
          ],
          modified: [],
          removed: [],
        },
      },
    })}\n\`\`\``;
    const result = parseExploreResponse(raw);
    expect(result.parseErrors).toEqual([]);
    expect(Object.keys(result.perCapability)).toEqual(['auth']);
    const auth = result.perCapability.auth;
    expect(auth.added).toHaveLength(1);
    expect(auth.added[0].name).toBe('Login');
    expect(auth.added[0].rfcKeywords).toContain('MUST');
    expect(auth.added[0].scenarios[0].name).toBe('Valid creds');
  });

  it('parses MODIFIED + REMOVED entries', () => {
    const raw = JSON.stringify({
      perCapability: {
        billing: {
          added: [],
          modified: [
            {
              name: 'Charge user',
              body: 'System SHALL charge.',
              scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
            },
          ],
          removed: ['Legacy refund'],
        },
      },
    });
    const result = parseExploreResponse(raw);
    expect(result.perCapability.billing.modified).toHaveLength(1);
    expect(result.perCapability.billing.removed).toEqual(['Legacy refund']);
  });

  it('returns empty perCapability + error when no JSON found', () => {
    const result = parseExploreResponse('I think we should scan things, but here is no JSON.');
    expect(result.perCapability).toEqual({});
    expect(result.parseErrors[0]).toMatch(/No JSON/);
  });

  it('returns empty perCapability + error on invalid JSON', () => {
    const result = parseExploreResponse('{ this is not valid json }');
    expect(result.perCapability).toEqual({});
    expect(result.parseErrors[0]).toMatch(/JSON.parse failed/);
  });

  it('skips malformed requirements but keeps valid ones', () => {
    const raw = JSON.stringify({
      perCapability: {
        x: {
          added: [
            { name: 'Good', body: 'MUST', scenarios: [{ name: 's', bodyLines: [] }] },
            { invalid: true },
          ],
          modified: [],
          removed: [],
        },
      },
    });
    const result = parseExploreResponse(raw);
    expect(result.perCapability.x.added).toHaveLength(1);
    expect(result.perCapability.x.added[0].name).toBe('Good');
  });
});

describe('AiExploreService (integration with mock aiRunPort)', () => {
  it('passes prompt + workingDirectory to aiRunPort and returns parsed result', async () => {
    let capturedInput = '';
    let capturedCwd = '';
    const fakePort = {
      async startVirtualRun(args: {
        input: string;
        workingDirectory?: string;
        onMessage?: (m: { kind: string; content?: string }) => void;
      }) {
        capturedInput = args.input;
        capturedCwd = args.workingDirectory ?? '';
        args.onMessage?.({
          kind: 'assistant',
          content: JSON.stringify({
            perCapability: {
              core: {
                added: [
                  {
                    name: 'A',
                    body: 'MUST',
                    scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
                  },
                ],
                modified: [],
                removed: [],
              },
            },
          }),
        });
        args.onMessage?.({ kind: 'run_completed' });
      },
    };
    const svc = new AiExploreService({ aiRunPort: fakePort, timeoutMs: 1000 });
    const result = await svc.explore({
      projectId: 'p1',
      workingDirectory: '/tmp/proj',
      mode: 'initial',
    });
    expect(capturedCwd).toBe('/tmp/proj');
    expect(capturedInput).toContain('perCapability');
    expect(result.perCapability.core.added[0].name).toBe('A');
  });

  it('returns empty result when aiRunPort throws (handled gracefully)', async () => {
    const fakePort = { startVirtualRun: vi.fn().mockRejectedValue(new Error('boom')) };
    const svc = new AiExploreService({ aiRunPort: fakePort, timeoutMs: 1000 });
    const result = await svc.explore({
      projectId: 'p1',
      workingDirectory: '/tmp/x',
      mode: 'initial',
    });
    expect(result.perCapability).toEqual({});
    expect(result.parseErrors[0]).toMatch(/No JSON/);
  });

  describe('discoverCapabilities (init Phase 1)', () => {
    it('returns capabilities + uncertainties on valid AI JSON', async () => {
      const fakePort = {
        async startVirtualRun(args: any) {
          args.onMessage?.({
            kind: 'assistant',
            content: JSON.stringify({
              capabilities: [
                { name: 'auth', description: 'sign-up / login' },
                { name: 'billing', description: 'subscriptions' },
              ],
              uncertainties: ['/vendor/legacy/ — unclear'],
            }),
          });
          args.onMessage?.({ kind: 'run_completed' });
        },
      };
      const svc = new AiExploreService({ aiRunPort: fakePort, timeoutMs: 1000 });
      const result = await svc.discoverCapabilities({
        projectId: 'p1',
        workingDirectory: '/tmp/x',
      });
      expect(result.capabilities.map(c => c.name)).toEqual(['auth', 'billing']);
      expect(result.uncertainties).toEqual(['/vendor/legacy/ — unclear']);
    });

    it('retries once when first response is not parseable JSON', async () => {
      let calls = 0;
      const fakePort = {
        async startVirtualRun(args: any) {
          calls += 1;
          if (calls === 1) {
            args.onMessage?.({ kind: 'assistant', content: 'I think it has these capabilities... no JSON here' });
            args.onMessage?.({ kind: 'run_completed' });
          } else {
            args.onMessage?.({
              kind: 'assistant',
              content: JSON.stringify({ capabilities: [{ name: 'a', description: 'x' }], uncertainties: [] }),
            });
            args.onMessage?.({ kind: 'run_completed' });
          }
        },
      };
      const svc = new AiExploreService({ aiRunPort: fakePort, timeoutMs: 1000 });
      const result = await svc.discoverCapabilities({ projectId: 'p1', workingDirectory: '/tmp/x' });
      expect(calls).toBe(2);
      expect(result.capabilities).toHaveLength(1);
    });

    it('throws after 2 failed parse attempts', async () => {
      const fakePort = {
        async startVirtualRun(args: any) {
          args.onMessage?.({ kind: 'assistant', content: 'no JSON' });
          args.onMessage?.({ kind: 'run_completed' });
        },
      };
      const svc = new AiExploreService({ aiRunPort: fakePort, timeoutMs: 1000 });
      await expect(svc.discoverCapabilities({ projectId: 'p1', workingDirectory: '/tmp/x' }))
        .rejects.toThrow(/parse|JSON/);
    });
  });
});
