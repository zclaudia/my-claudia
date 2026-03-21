import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../plugins/tool-registry.js', () => ({
  toolRegistry: {
    getBridgeTools: vi.fn().mockReturnValue([]),
    execute: vi.fn(),
    get: vi.fn().mockReturnValue(undefined),
  },
}));

import { createPluginToolsRoutes } from '../plugin-tools.js';
import { toolRegistry } from '../../plugins/tool-registry.js';
import type { PCPEffectiveProfile } from '@my-claudia/shared';

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
      vi.mocked(toolRegistry.getBridgeTools).mockReturnValue([]);
      const res = await request(app).get('/api/plugins/tools');
      expect(res.status).toBe(200);
      expect(res.body.tools).toEqual([]);
    });

    it('returns only plugin tools in MCP format', async () => {
      vi.mocked(toolRegistry.getBridgeTools).mockReturnValue([
        {
          source: 'plugin',
          definition: { function: { name: 'tool1', description: 'desc1', parameters: { type: 'object' } } },
        },
      ] as any);

      const res = await request(app).get('/api/plugins/tools');
      expect(res.status).toBe(200);
      expect(res.body.tools).toHaveLength(1);
      expect(res.body.tools[0].name).toBe('tool1');
    });

    it('filters interaction tools by active PCP profile', async () => {
      vi.mocked(toolRegistry.getBridgeTools).mockReturnValue([
        {
          source: 'interaction',
          definition: { function: { name: 'ask_user_form', description: 'ask', parameters: { type: 'object' } } },
        },
        {
          source: 'interaction',
          definition: { function: { name: 'push_file', description: 'push', parameters: { type: 'object' } } },
        },
      ] as any);

      const profile: PCPEffectiveProfile = {
        providerId: 'cursor',
        providerType: 'cursor',
        negotiatedAt: Date.now(),
        capabilities: [
          { id: 'interaction.form', enabled: false, degradation: 'fallback_to_notice' },
          { id: 'tool.inject', enabled: true, mode: 'bridged', reliability: 'best_effort', degradation: 'reject' },
        ],
      };

      app = express();
      app.use(express.json());
      app.use('/api/plugins', createPluginToolsRoutes({
        getActiveProfile: () => profile,
      }));

      const res = await request(app).get('/api/plugins/tools').query({ sessionId: 'session-1' });
      expect(res.status).toBe(200);
      expect(res.body.tools).toEqual([
        { name: 'push_file', description: 'push', inputSchema: { type: 'object' } },
      ]);
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
      expect(toolRegistry.execute).toHaveBeenCalledWith('my_tool', { key: 'val' }, { sessionId: undefined });
    });

    it('handles args field', async () => {
      vi.mocked(toolRegistry.execute).mockResolvedValue('ok');

      const res = await request(app)
        .post('/api/plugins/tools/my_tool/execute')
        .send({ args: { foo: 'bar' } });

      expect(res.status).toBe(200);
      expect(toolRegistry.execute).toHaveBeenCalledWith('my_tool', { foo: 'bar' }, { sessionId: undefined });
    });

    it('passes sessionId through execution context', async () => {
      vi.mocked(toolRegistry.execute).mockResolvedValue('ok');

      const res = await request(app)
        .post('/api/plugins/tools/my_tool/execute')
        .send({ arguments: { foo: 'bar' }, sessionId: 'session-123' });

      expect(res.status).toBe(200);
      expect(toolRegistry.execute).toHaveBeenCalledWith('my_tool', { foo: 'bar' }, { sessionId: 'session-123' });
    });

    it('returns 500 on execution error', async () => {
      vi.mocked(toolRegistry.execute).mockRejectedValue(new Error('tool failed'));

      const res = await request(app)
        .post('/api/plugins/tools/my_tool/execute')
        .send({ arguments: {} });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('tool failed');
    });

    it('rejects execution when PCP profile disables the interaction tool', async () => {
      const profile: PCPEffectiveProfile = {
        providerId: 'cursor',
        providerType: 'cursor',
        negotiatedAt: Date.now(),
        capabilities: [
          { id: 'interaction.form', enabled: false, degradation: 'fallback_to_notice' },
        ],
      };

      app = express();
      app.use(express.json());
      app.use('/api/plugins', createPluginToolsRoutes({
        getActiveProfile: () => profile,
      }));

      const res = await request(app)
        .post('/api/plugins/tools/ask_user_form/execute')
        .send({ arguments: { foo: 'bar' }, sessionId: 'session-123' });

      expect(res.status).toBe(200);
      expect(res.body.result).toContain('not available for this provider');
      expect(toolRegistry.execute).not.toHaveBeenCalled();
    });
  });
});
