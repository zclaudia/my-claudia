import { Router, Request, Response } from 'express';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export function createSystemStatsRoutes(): Router {
  const router = Router();

  // GET /api/system/stats - CPU, memory, uptime
  router.get('/stats', (_req: Request, res: Response) => {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Calculate aggregate CPU usage from idle/total times
    let totalIdle = 0, totalTick = 0;
    for (const cpu of cpus) {
      for (const type of Object.values(cpu.times)) {
        totalTick += type;
      }
      totalIdle += cpu.times.idle;
    }
    const cpuUsagePercent = Math.round(100 - (100 * totalIdle / totalTick));

    res.json({
      success: true,
      data: {
        cpu: {
          model: cpus[0]?.model || 'Unknown',
          cores: cpus.length,
          usagePercent: cpuUsagePercent,
          loadAvg: os.loadavg(),
        },
        memory: {
          total: totalMem,
          used: usedMem,
          free: freeMem,
          usagePercent: Math.round((usedMem / totalMem) * 100),
        },
        uptime: os.uptime(),
        platform: os.platform(),
        hostname: os.hostname(),
        nodeVersion: process.version,
      }
    });
  });

  // GET /api/system/plugin-storage/:pluginId - read plugin storage JSON file
  router.get('/plugin-storage/:pluginId', (req: Request, res: Response) => {
    const { pluginId } = req.params;
    // Validate pluginId — only allow alphanumeric, dots, hyphens
    if (!/^[\w.-]+$/.test(pluginId)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid plugin ID' } });
      return;
    }

    const storagePath = path.join(os.homedir(), '.claudia', 'plugin-storage', `${pluginId}.json`);
    if (!fs.existsSync(storagePath)) {
      res.json({ success: true, data: {} });
      return;
    }

    try {
      const content = fs.readFileSync(storagePath, 'utf-8');
      res.json({ success: true, data: JSON.parse(content) });
    } catch {
      res.status(500).json({ success: false, error: { code: 'READ_ERROR', message: 'Failed to read plugin storage' } });
    }
  });

  return router;
}
