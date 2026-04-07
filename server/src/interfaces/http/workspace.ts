/**
 * Workspace API Routes
 *
 * Provides HTTP endpoints for managing Agent Workspace configuration:
 * - SOUL.md (Agent personality/identity)
 * - AGENTS.md (Behavior rules)
 * - TOOLS.md (Tool usage guidelines)
 * - Skills (Pluggable skill modules)
 */

import { Router, type Request, type Response } from 'express';
import { workspaceService } from '../../application/services/workspace.js';
import { refreshSkillTools, getExternalSkillDirs, saveExternalSkillDirs } from '../../application/plugins/skill-tools.js';
import path from 'path';
import fs from 'fs/promises';
import { sendApiError } from './response.js';

export function createWorkspaceRoutes(): ReturnType<typeof Router> {
  const router = Router();

  /**
 * GET /api/workspace/config
 * Get current workspace configuration (SOUL.md, AGENTS.md, TOOLS.md)
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const config = await workspaceService.getConfig();
    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('[Workspace API] Error getting config:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to get workspace config',
    );
  }
});

/**
 * PUT /api/workspace/config
 * Update workspace configuration files
 * Body: { soul?: string, agents?: string, tools?: string }
 */
router.put('/config', async (req: Request, res: Response) => {
  try {
    const { soul, agents, tools } = req.body;

    // Validate input
    const updates: { soul?: string; agents?: string; tools?: string } = {};
    if (soul !== undefined) updates.soul = soul;
    if (agents !== undefined) updates.agents = agents;
    if (tools !== undefined) updates.tools = tools;

    if (Object.keys(updates).length === 0) {
      sendApiError(res, 400, 'VALIDATION_ERROR', 'No configuration fields provided');
      return;
    }

    await workspaceService.updateConfig(updates);

    res.json({
      success: true,
      message: 'Workspace configuration updated',
    });
  } catch (error) {
    console.error('[Workspace API] Error updating config:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to update workspace config',
    );
  }
});

/**
 * GET /api/workspace/skills
 * List all available skills
 */
router.get('/skills', async (req: Request, res: Response) => {
  try {
    const skills = await workspaceService.listSkills();
    res.json({
      success: true,
      data: skills,
    });
  } catch (error) {
    console.error('[Workspace API] Error listing skills:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to list skills',
    );
  }
});

/**
 * GET /api/workspace/skills/:skillId
 * Get a specific skill's content
 */
router.get('/skills/:skillId', async (req: Request, res: Response) => {
  try {
    const { skillId } = req.params;
    const content = await workspaceService.loadSkill(skillId);

    if (content === null) {
      sendApiError(res, 404, 'NOT_FOUND', `Skill not found: ${skillId}`);
      return;
    }

    res.json({
      success: true,
      data: { id: skillId, content },
    });
  } catch (error) {
    console.error('[Workspace API] Error loading skill:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to load skill',
    );
  }
});

/**
 * POST /api/workspace/skills/:skillId
 * Create or update a skill
 * Body: { content: string }
 */
router.post('/skills/:skillId', async (req: Request, res: Response) => {
  try {
    const { skillId } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== 'string') {
      sendApiError(res, 400, 'VALIDATION_ERROR', 'Content is required and must be a string');
      return;
    }

    // Security check: prevent path traversal
    const normalizedId = path.basename(skillId);
    if (normalizedId !== skillId || skillId.includes('..')) {
      sendApiError(res, 400, 'VALIDATION_ERROR', 'Invalid skill ID');
      return;
    }

    const skillDir = path.join(workspaceService.getWorkspaceDir(), 'skills', skillId);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');

    // Clear cache for this skill and refresh tool registry
    workspaceService.clearCache();
    await refreshSkillTools();

    res.json({
      success: true,
      message: `Skill ${skillId} saved`,
    });
  } catch (error) {
    console.error('[Workspace API] Error saving skill:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to save skill',
    );
  }
});

/**
 * DELETE /api/workspace/skills/:skillId
 * Delete a skill
 */
router.delete('/skills/:skillId', async (req: Request, res: Response) => {
  try {
    const { skillId } = req.params;

    // Security check: prevent path traversal
    const normalizedId = path.basename(skillId);
    if (normalizedId !== skillId || skillId.includes('..')) {
      sendApiError(res, 400, 'VALIDATION_ERROR', 'Invalid skill ID');
      return;
    }

    const skillDir = path.join(workspaceService.getWorkspaceDir(), 'skills', skillId);

    try {
      await fs.rm(skillDir, { recursive: true });
    } catch (e) {
      // Directory doesn't exist
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
    }

    // Clear cache and refresh tool registry
    workspaceService.clearCache();
    await refreshSkillTools();

    res.json({
      success: true,
      message: `Skill ${skillId} deleted`,
    });
  } catch (error) {
    console.error('[Workspace API] Error deleting skill:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to delete skill',
    );
  }
});

/**
 * GET /api/workspace/skill-dirs
 * Get configured external skill directories
 */
router.get('/skill-dirs', (req: Request, res: Response) => {
  try {
    const dirs = getExternalSkillDirs();
    res.json({ success: true, data: dirs });
  } catch (error) {
    console.error('[Workspace API] Error getting skill dirs:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to get skill dirs',
    );
  }
});

/**
 * PUT /api/workspace/skill-dirs
 * Update external skill directories
 * Body: { dirs: string[] }
 */
router.put('/skill-dirs', async (req: Request, res: Response) => {
  try {
    const { dirs } = req.body;
    if (!Array.isArray(dirs) || !dirs.every((d: unknown) => typeof d === 'string')) {
      sendApiError(res, 400, 'VALIDATION_ERROR', 'dirs must be an array of strings');
      return;
    }

    saveExternalSkillDirs(dirs);
    const count = await refreshSkillTools();

    res.json({
      success: true,
      message: `Skill dirs updated, ${count} skill(s) registered`,
    });
  } catch (error) {
    console.error('[Workspace API] Error updating skill dirs:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to update skill dirs',
    );
  }
});

/**
 * GET /api/workspace/preview
 * Preview the assembled system prompt for a project
 * Query params: projectId, projectPath
 */
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const { projectId, projectPath, skills } = req.query;

    const skillsArray = skills
      ? (typeof skills === 'string' ? skills.split(',').filter(Boolean) : [])
      : [];

    const assembledPrompt = await workspaceService.assembleSystemPrompt({
      projectId: projectId as string | undefined,
      projectPath: projectPath as string | undefined,
      skills: skillsArray,
    });

    res.json({
      success: true,
      data: {
        prompt: assembledPrompt,
        length: assembledPrompt.length,
      },
    });
  } catch (error) {
    console.error('[Workspace API] Error previewing prompt:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to preview prompt',
    );
  }
});

/**
 * POST /api/workspace/reset
 * Reset workspace to default values
 */
router.post('/reset', async (req: Request, res: Response) => {
  try {
    const workspaceDir = workspaceService.getWorkspaceDir();

    // Backup existing files
    const backupDir = path.join(workspaceDir, 'backup', new Date().toISOString().replace(/[:.]/g, '-'));
    await fs.mkdir(backupDir, { recursive: true });

    const files = ['SOUL.md', 'AGENTS.md', 'TOOLS.md'];
    for (const file of files) {
      const filePath = path.join(workspaceDir, file);
      try {
        await fs.copyFile(filePath, path.join(backupDir, file));
      } catch {
        // File doesn't exist, skip
      }
    }

    // Clear cache and reinitialize
    workspaceService.clearCache();
    workspaceService['initialized'] = false;
    await workspaceService.initialize();

    res.json({
      success: true,
      message: 'Workspace reset to defaults',
      data: { backupDir },
    });
  } catch (error) {
    console.error('[Workspace API] Error resetting workspace:', error);
    sendApiError(
      res,
      500,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to reset workspace',
    );
  }
});

  return router;
}
