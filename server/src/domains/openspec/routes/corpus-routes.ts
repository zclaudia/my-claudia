import { Router, type Request, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSpec } from '../markdown/spec-parser.js';

export interface CorpusRoutesDeps {
  getProjectRoot: (projectId: string) => string;
}

export function createCorpusRoutes(deps: CorpusRoutesDeps): Router {
  const router = Router();

  router.get('/corpus', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param required' });
      return;
    }
    try {
      const root = deps.getProjectRoot(projectId);
      const specsDir = path.join(root, 'openspec', 'specs');
      if (!fs.existsSync(specsDir)) {
        res.json({ capabilities: [] });
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
      res.json({ capabilities });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  router.get('/corpus/:capability', (req: Request, res: Response) => {
    const projectId = req.query.projectId as string | undefined;
    if (!projectId) {
      res.status(400).json({ error: 'projectId query param required' });
      return;
    }
    try {
      const root = deps.getProjectRoot(projectId);
      const file = path.join(root, 'openspec', 'specs', req.params.capability, 'spec.md');
      if (!fs.existsSync(file)) {
        res.status(404).json({ error: 'capability not found in corpus' });
        return;
      }
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = parseSpec(raw);
      res.json({ capability: req.params.capability, raw, parsed });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return router;
}
