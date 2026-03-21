import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillMeta } from '../skill-tools.js';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

async function loadSelector() {
  vi.resetModules();
  return import('../skill-selector.js');
}

function makeSkill(overrides: Partial<SkillMeta> = {}): SkillMeta {
  return {
    id: 'skill-one',
    name: 'Skill One',
    description: 'Skill description',
    dirPath: '/tmp/skill-one',
    source: 'workspace',
    priority: 100,
    ...overrides,
  };
}

describe('plugins/skill-selector', () => {
  const originalEnv = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalEnv;
    }
  });

  it('selects matching skills by trigger and sorts by priority', async () => {
    const { selectSkills } = await loadSelector();

    const skills = [
      makeSkill({
        id: 'low-priority',
        priority: 50,
        triggers: { keywords: ['review'] },
      }),
      makeSkill({
        id: 'high-priority',
        priority: 10,
        triggers: { keywords: ['review'] },
      }),
      makeSkill({
        id: 'project-match',
        priority: 20,
        triggers: { projectType: ['code'] },
      }),
      makeSkill({
        id: 'on-demand-only',
      }),
    ];

    const selected = selectSkills(skills, {
      userInput: 'Please review this PR',
      projectType: 'code',
    });

    expect(selected.map(skill => skill.id)).toEqual([
      'high-priority',
      'project-match',
      'low-priority',
    ]);
  });

  it('enforces OS aliases, binaries, and env requirements', async () => {
    const { execFileSync } = await import('child_process');
    vi.mocked(execFileSync).mockImplementation((cmd, args) => {
      if (cmd === 'which' && Array.isArray(args) && args[0] === 'git') {
        return Buffer.from('/usr/bin/git');
      }
      throw new Error('missing binary');
    });
    process.env.GITHUB_TOKEN = 'token';

    const { selectSkills } = await loadSelector();

    const selected = selectSkills([
      makeSkill({
        id: 'eligible',
        triggers: { keywords: ['ship'] },
        requires: { os: ['macos'], binaries: ['git'], env: ['GITHUB_TOKEN'] },
      }),
      makeSkill({
        id: 'wrong-os',
        triggers: { keywords: ['ship'] },
        requires: { os: ['windows'] },
      }),
      makeSkill({
        id: 'missing-binary',
        triggers: { keywords: ['ship'] },
        requires: { binaries: ['docker'] },
      }),
    ], {
      userInput: 'ship it',
      os: 'darwin',
    });

    expect(selected.map(skill => skill.id)).toEqual(['eligible']);
  });

  it('never auto-injects skills without triggers', async () => {
    const { selectSkills } = await loadSelector();

    const selected = selectSkills([
      makeSkill({
        id: 'manual-only',
        requires: { os: ['linux'] },
      }),
    ], {
      userInput: 'anything',
      os: 'linux',
    });

    expect(selected).toEqual([]);
  });
});
