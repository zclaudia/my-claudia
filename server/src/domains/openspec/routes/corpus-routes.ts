import { Router, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import { parseSpec } from '../markdown/spec-parser.js';

const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });
const err = (code: string, message: string): ApiResponse<never> => ({
  success: false,
  error: { code, message },
});

export interface CorpusRoutesDeps {
  getProjectRoot: (projectId: string) => string;
}

export function createCorpusRoutes(deps: CorpusRoutesDeps): Router {
  const router = Router();

  router.get('/corpus', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json(err('VALIDATION', 'projectId query param required'));
      return;
    }
    try {
      const root = deps.getProjectRoot(projectId);
      const specsDir = path.join(root, 'openspec', 'specs');
      if (!fs.existsSync(specsDir)) {
        res.json(ok({ capabilities: [] }));
        return;
      }
      const capabilities = fs.readdirSync(specsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const file = path.join(specsDir, e.name, 'spec.md');
          if (!fs.existsSync(file)) return null;
          const parsed = parseSpec(fs.readFileSync(file, 'utf-8'));
          return {
            capability: e.name,
            requirementCount: parsed.requirements.length,
            scenarioCount: parsed.requirements.reduce((s, r) => s + r.scenarios.length, 0),
            lastUpdatedAt: fs.statSync(file).mtimeMs,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      res.json(ok({ capabilities }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  router.get('/corpus/:capability', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json(err('VALIDATION', 'projectId query param required'));
      return;
    }
    try {
      const root = deps.getProjectRoot(projectId);
      const file = path.join(root, 'openspec', 'specs', req.params.capability, 'spec.md');
      if (!fs.existsSync(file)) {
        res.status(404).json(err('NOT_FOUND', 'capability not found in corpus'));
        return;
      }
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = parseSpec(raw);
      res.json(ok({ capability: req.params.capability, raw, parsed }));
    } catch (e) {
      res.status(400).json(err('OPENSPEC_ERROR', (e as Error).message));
    }
  });

  return router;
}
