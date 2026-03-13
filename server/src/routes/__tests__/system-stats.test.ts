import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSystemStatsRoutes } from '../system-stats.js';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import * as fs from 'fs';

describe('system-stats routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use('/api/system', createSystemStatsRoutes());
  });

  describe('GET /api/system/stats', () => {
    it('returns system stats', async () => {
      const res = await request(app).get('/api/system/stats');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('cpu');
      expect(res.body.data).toHaveProperty('memory');
      expect(res.body.data).toHaveProperty('uptime');
      expect(res.body.data).toHaveProperty('platform');
      expect(res.body.data).toHaveProperty('hostname');
      expect(res.body.data).toHaveProperty('nodeVersion');
      expect(res.body.data.cpu).toHaveProperty('cores');
      expect(res.body.data.cpu).toHaveProperty('usagePercent');
      expect(res.body.data.memory).toHaveProperty('total');
      expect(res.body.data.memory).toHaveProperty('free');
      expect(res.body.data.memory).toHaveProperty('usagePercent');
    });
  });

  describe('GET /api/system/plugin-storage/:pluginId', () => {
    it('returns 400 for invalid plugin ID', async () => {
      const res = await request(app).get('/api/system/plugin-storage/bad%20id!@#');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_ID');
    });

    it('returns empty object when storage file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const res = await request(app).get('/api/system/plugin-storage/com.example.plugin');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({});
    });

    it('returns plugin storage data', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ key: 'value' }));

      const res = await request(app).get('/api/system/plugin-storage/com.example.plugin');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ key: 'value' });
    });

    it('returns 500 when reading fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Read error');
      });

      const res = await request(app).get('/api/system/plugin-storage/com.example.plugin');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('READ_ERROR');
    });

    it('accepts valid plugin IDs with dots and hyphens', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const res = await request(app).get('/api/system/plugin-storage/com.my-plugin.v2');
      expect(res.status).toBe(200);
    });
  });
});
