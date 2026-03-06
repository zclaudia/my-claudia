import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCommandsRoutes } from '../commands.js';

// Mock the fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock os module for homedir
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(() => '/home/testuser'),
  };
});

import * as fs from 'fs';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/commands', createCommandsRoutes());
  return app;
}

describe('commands routes', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('POST /api/commands/list', () => {
    it('returns builtin and custom commands', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false); // No custom commands

      const res = await request(app)
        .post('/api/commands/list')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.builtin).toBeDefined();
      expect(Array.isArray(res.body.data.builtin)).toBe(true);
      expect(res.body.data.custom).toBeDefined();
      expect(res.body.data.count).toBeDefined();
    });

    it('scans project commands when projectPath provided', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('/my-project/.claude/commands');
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'deploy.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.readFileSync).mockReturnValue('# Deploy Command\nDeploy to production');

      const res = await request(app)
        .post('/api/commands/list')
        .send({ projectPath: '/my-project' });

      expect(res.status).toBe(200);
      expect(res.body.data.custom.length).toBeGreaterThanOrEqual(1);
      // Verify project command is found
      const deployCmd = res.body.data.custom.find((cmd: { command: string }) => cmd.command === '/deploy');
      expect(deployCmd).toBeDefined();
    });

    it('scans user commands from ~/.claude/commands', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return typeof path === 'string' && path.includes('/home/testuser/.claude/commands');
      });
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'global-cmd.md', isDirectory: () => false, isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      vi.mocked(fs.readFileSync).mockReturnValue('# Global Command\nA global command');

      const res = await request(app)
        .post('/api/commands/list')
        .send({});

      expect(res.status).toBe(200);
      const globalCmd = res.body.data.custom.find((cmd: { command: string }) => cmd.command === '/global-cmd');
      expect(globalCmd).toBeDefined();
    });
  });

  describe('POST /api/commands/execute', () => {
    describe('builtin commands', () => {
      it('handles /clear command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/clear' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('clear');
      });

      it('handles /help command with markdown content', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/help' });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('help');
        expect(res.body.data.data.format).toBe('markdown');
        expect(res.body.data.data.content).toContain('Commands');
      });

      it('handles /status command with system info', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/status',
            context: { model: 'claude-3', provider: 'claude' }
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('status');
        expect(res.body.data.data.model).toBe('claude-3');
        expect(res.body.data.data.provider).toBe('claude');
        expect(res.body.data.data.platform).toBeDefined();
      });

      it('handles /model command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/model',
            context: { model: 'claude-3-opus', provider: 'claude' }
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('model');
        expect(res.body.data.data.model).toBe('claude-3-opus');
      });

      it('handles /cost command with token usage', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/cost',
            context: { tokenUsage: { used: 5000, total: 100000 } }
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('cost');
        expect(res.body.data.data.tokenUsage.used).toBe(5000);
        expect(res.body.data.data.tokenUsage.total).toBe(100000);
        expect(res.body.data.data.tokenUsage.percentage).toBe('5.0');
      });

      it('handles /memory command', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/memory',
            context: { projectPath: '/my-project' }
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('memory');
        expect(res.body.data.data.path).toContain('CLAUDE.md');
        expect(res.body.data.data.exists).toBe(true);
      });

      it('handles /config command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/config' });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('config');
      });

      it('handles /new-session command', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/new-session' });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('builtin');
        expect(res.body.data.action).toBe('new-session');
      });
    });

    describe('custom commands', () => {
      it('returns 400 when commandName is missing', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('returns 400 when commandPath missing for custom commands', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({ commandName: '/custom-cmd' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });

      it('returns 403 for paths outside .claude/commands', async () => {
        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/evil-cmd',
            commandPath: '/etc/passwd',
            context: { projectPath: '/my-project' }
          });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it('returns 404 when command file not found', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/missing-cmd',
            commandPath: '/home/testuser/.claude/commands/missing.md',
            context: {}
          });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });

      it('reads and processes command content', async () => {
        const commandContent = '# Test Command\nThis is a test command content.';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(commandContent);

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/test-cmd',
            commandPath: '/home/testuser/.claude/commands/test-cmd.md',
            context: {}
          });

        expect(res.status).toBe(200);
        expect(res.body.data.type).toBe('custom');
        expect(res.body.data.content).toBe(commandContent);
      });

      it('replaces $ARGUMENTS placeholder', async () => {
        const commandContent = 'Run: $ARGUMENTS';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(commandContent);

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/run-cmd',
            commandPath: '/home/testuser/.claude/commands/run-cmd.md',
            args: ['npm', 'test'],
            context: {}
          });

        expect(res.status).toBe(200);
        expect(res.body.data.content).toBe('Run: npm test');
      });

      it('replaces $1, $2, etc. positional placeholders', async () => {
        const commandContent = 'Deploy $1 to $2';
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(commandContent);

        const res = await request(app)
          .post('/api/commands/execute')
          .send({
            commandName: '/deploy-cmd',
            commandPath: '/home/testuser/.claude/commands/deploy-cmd.md',
            args: ['app', 'production'],
            context: {}
          });

        expect(res.status).toBe(200);
        expect(res.body.data.content).toBe('Deploy app to production');
      });
    });
  });
});
