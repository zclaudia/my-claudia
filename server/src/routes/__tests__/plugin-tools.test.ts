import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../plugins/tool-registry.js', () => ({
  toolRegistry: {
    getAll: vi.fn().mockReturnValue([]),
    execute: vi.fn(),
  },
}));

import { createPluginToolsRoutes } from '../plugin-tools.js';
import { toolRegistry } from '../../plugins/tool-registry.js';

describe('plugin-tools routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/plugins', createPluginToolsRoutes());
  });

  describe('GET /api/plugins/tools', () => {
    it('returns empty array when no plugin tools', async () => {
      vi.mocked(toolRegistry.getAll).mockReturnValue([]);
      const res = await request(app).get('/api/plugins/tools');
      expect(res.status).toBe(200);
      expect(res.body.tools).toEqual([]);
    });

    it('returns only plugin tools in MCP format', async () => {
      vi.mocked(toolRegistry.getAll).mockReturnValue([
        {
          source: 'plugin',
          definition: { function: { name: 'tool1', description: 'desc1', parameters: { type: 'object' } } },
        },
        {
          source: 'builtin',
          definition: { function: { name: 'tool2', description: 'desc2', parameters: {} } },
        },
      ] as any);

      const res = await request(app).get('/api/plugins/tools');
      expect(res.status).toBe(200);
      expect(res.body.tools).toHaveLength(1);
      expect(res.body.tools[0].name).toBe('tool1');
    });
  });

  describe('POST /api/plugins/tools/:name/execute', () => {
    it('executes tool and returns result', async () => {
      vi.mocked(toolRegistry.execute).mockResolvedValue('result-value');

      const res = await request(app)
        .post('/api/plugins/tools/my_tool/execute')
        .send({ arguments: { key: 'val' } });

      expect(res.status).toBe(200);
      expect(res.body.result).toBe('result-value');
      expect(toolRegistry.execute).toHaveBeenCalledWith('my_tool', { key: 'val' });
    });

    it('handles args field', async () => {
      vi.mocked(toolRegistry.execute).mockResolvedValue('ok');

      const res = await request(app)
        .post('/api/plugins/tools/my_tool/execute')
        .send({ args: { foo: 'bar' } });

      expect(res.status).toBe(200);
      expect(toolRegistry.execute).toHaveBeenCalledWith('my_tool', { foo: 'bar' });
    });

    it('returns 500 on execution error', async () => {
      vi.mocked(toolRegistry.execute).mockRejectedValue(new Error('tool failed'));

      const res = await request(app)
        .post('/api/plugins/tools/my_tool/execute')
        .send({ arguments: {} });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('tool failed');
    });
  });
});
