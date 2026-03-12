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
import { workspaceService } from '../services/workspace.js';
import path from 'path';
import fs from 'fs/promises';

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
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get workspace config',
    });
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
      res.status(400).json({
        success: false,
        error: 'No configuration fields provided',
      });
      return;
    }

    await workspaceService.updateConfig(updates);

    res.json({
      success: true,
      message: 'Workspace configuration updated',
    });
  } catch (error) {
    console.error('[Workspace API] Error updating config:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update workspace config',
    });
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
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list skills',
    });
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
      res.status(404).json({
        success: false,
        error: `Skill not found: ${skillId}`,
      });
      return;
    }

    res.json({
      success: true,
      data: { id: skillId, content },
    });
  } catch (error) {
    console.error('[Workspace API] Error loading skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load skill',
    });
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
      res.status(400).json({
        success: false,
        error: 'Content is required and must be a string',
      });
      return;
    }

    // Security check: prevent path traversal
    const normalizedId = path.basename(skillId);
    if (normalizedId !== skillId || skillId.includes('..')) {
      res.status(400).json({
        success: false,
        error: 'Invalid skill ID',
      });
      return;
    }

    const skillDir = path.join(workspaceService.getWorkspaceDir(), 'skills', skillId);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');

    // Clear cache for this skill
    workspaceService.clearCache();

    res.json({
      success: true,
      message: `Skill ${skillId} saved`,
    });
  } catch (error) {
    console.error('[Workspace API] Error saving skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save skill',
    });
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
      res.status(400).json({
        success: false,
        error: 'Invalid skill ID',
      });
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

    // Clear cache
    workspaceService.clearCache();

    res.json({
      success: true,
      message: `Skill ${skillId} deleted`,
    });
  } catch (error) {
    console.error('[Workspace API] Error deleting skill:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete skill',
    });
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
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to preview prompt',
    });
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
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reset workspace',
    });
  }
});

  return router;
}
