import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkspaceRoutes } from '../workspace.js';
import { workspaceService } from '../../services/workspace.js';
import { getExternalSkillDirs, refreshSkillTools, saveExternalSkillDirs } from '../../domains/plugins/skill-tools.js';

vi.mock('../../services/workspace.js', () => ({
  workspaceService: {
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    listSkills: vi.fn(),
    loadSkill: vi.fn(),
    getWorkspaceDir: vi.fn(() => '/tmp/my-claudia-workspace'),
    clearCache: vi.fn(),
    assembleSystemPrompt: vi.fn(),
    initialize: vi.fn(),
  },
}));

vi.mock('../../domains/plugins/skill-tools.js', () => ({
  refreshSkillTools: vi.fn(),
  getExternalSkillDirs: vi.fn(),
  saveExternalSkillDirs: vi.fn(),
}));

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workspace', createWorkspaceRoutes());
  return app;
}

describe('workspace routes', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceService.getConfig).mockResolvedValue({
      soul: null,
      agents: null,
      tools: null,
    });
    vi.mocked(workspaceService.loadSkill).mockResolvedValue('# Skill');
    vi.mocked(getExternalSkillDirs).mockReturnValue([]);
    vi.mocked(refreshSkillTools).mockResolvedValue(0);
  });

  it('returns structured 400 when config update body is empty', async () => {
    const res = await request(app)
      .put('/api/workspace/config')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'No configuration fields provided',
      },
    });
  });

  it('returns structured 404 when skill does not exist', async () => {
    vi.mocked(workspaceService.loadSkill).mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/workspace/skills/missing-skill');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Skill not found: missing-skill',
      },
    });
  });

  it('returns structured 400 for invalid skill id on save', async () => {
    const res = await request(app)
      .post('/api/workspace/skills/bad..skill')
      .send({ content: '# bad' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid skill ID',
      },
    });
  });

  it('returns structured 400 when skill dirs payload is invalid', async () => {
    const res = await request(app)
      .put('/api/workspace/skill-dirs')
      .send({ dirs: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'dirs must be an array of strings',
      },
    });
    expect(saveExternalSkillDirs).not.toHaveBeenCalled();
  });

  it('returns structured 500 when get config fails', async () => {
    vi.mocked(workspaceService.getConfig).mockRejectedValueOnce(new Error('boom'));

    const res = await request(app)
      .get('/api/workspace/config');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'boom',
      },
    });
  });
});
