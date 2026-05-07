import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';

import { createAttachmentRoutes } from '../routes.js';
import { AttachmentService } from '../service.js';
import { registerOwnerGuard, __resetOwnerGuards } from '../access-control.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      owner_kind TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'file',
      sha256 TEXT,
      width INTEGER,
      height INTEGER,
      created_by TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

async function initRealStore(): Promise<{ tmpDir: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudia-att-routes-'));
  process.env.MY_CLAUDIA_DATA_DIR = tmpDir;
  // Don't resetModules — we share the same module graph as routes/service so
  // their lazy `attachmentStore` Proxy must observe our initialized instance.
  const mod = await import('../../../infrastructure/storage/attachmentStore.js');
  mod.initAttachmentStore();
  return { tmpDir };
}

async function buildApp() {
  const { tmpDir } = await initRealStore();
  const db = createTestDb();
  const broadcasts: unknown[] = [];
  const service = new AttachmentService(db, (msg) => broadcasts.push(msg));
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', createAttachmentRoutes(service));
  return { app, db, broadcasts, tmpDir, service };
}

describe('attachment routes', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    __resetOwnerGuards();
    ctx = await buildApp();
  });

  afterEach(() => {
    __resetOwnerGuards();
    ctx.db.close();
    fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
    delete process.env.MY_CLAUDIA_DATA_DIR;
  });

  describe('POST /api/attachments (multipart)', () => {
    it('uploads a file and returns the attachment', async () => {
      const res = await request(ctx.app)
        .post('/api/attachments')
        .field('ownerKind', 'local_issue')
        .field('ownerId', 'issue-1')
        .attach('file', Buffer.from('hello'), {
          filename: 'hello.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        ownerKind: 'local_issue',
        ownerId: 'issue-1',
        name: 'hello.png',
        mimeType: 'image/png',
        size: 5,
        kind: 'image',
      });
      expect(ctx.broadcasts).toHaveLength(1);
    });

    it('rejects when ownerKind missing', async () => {
      const res = await request(ctx.app)
        .post('/api/attachments')
        .field('ownerId', 'issue-1')
        .attach('file', Buffer.from('x'), 'a.png');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unknown ownerKind', async () => {
      const res = await request(ctx.app)
        .post('/api/attachments')
        .field('ownerKind', 'evil_kind')
        .field('ownerId', 'x')
        .attach('file', Buffer.from('x'), 'a.png');
      expect(res.status).toBe(400);
    });

    it('honors registered owner guard', async () => {
      registerOwnerGuard('local_issue', () => false);
      const res = await request(ctx.app)
        .post('/api/attachments')
        .field('ownerKind', 'local_issue')
        .field('ownerId', 'issue-1')
        .attach('file', Buffer.from('x'), 'a.png');
      expect(res.status).toBe(403);
    });

    it('rejects without a file', async () => {
      const res = await request(ctx.app)
        .post('/api/attachments')
        .field('ownerKind', 'local_issue')
        .field('ownerId', 'issue-1');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FILE');
    });
  });

  describe('POST /api/attachments/json', () => {
    it('uploads via base64 JSON body', async () => {
      const data = Buffer.from('hello-json').toString('base64');
      const res = await request(ctx.app)
        .post('/api/attachments/json')
        .send({
          ownerKind: 'local_issue',
          ownerId: 'issue-1',
          name: 'h.txt',
          mimeType: 'text/plain',
          data,
        });
      expect(res.status).toBe(201);
      expect(res.body.data.kind).toBe('document');
      expect(res.body.data.size).toBe(Buffer.from('hello-json').length);
    });

    it('400 when fields missing', async () => {
      const res = await request(ctx.app)
        .post('/api/attachments/json')
        .send({ ownerKind: 'local_issue', ownerId: 'x' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/attachments', () => {
    it('lists attachments for an owner', async () => {
      await request(ctx.app)
        .post('/api/attachments/json')
        .send({
          ownerKind: 'local_issue',
          ownerId: 'i-1',
          name: 'a.png',
          mimeType: 'image/png',
          data: Buffer.from('a').toString('base64'),
        });
      await request(ctx.app)
        .post('/api/attachments/json')
        .send({
          ownerKind: 'local_issue',
          ownerId: 'i-2',
          name: 'b.png',
          mimeType: 'image/png',
          data: Buffer.from('b').toString('base64'),
        });

      const res = await request(ctx.app)
        .get('/api/attachments')
        .query({ ownerKind: 'local_issue', ownerId: 'i-1' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].ownerId).toBe('i-1');
    });

    it('400 without owner params', async () => {
      const res = await request(ctx.app).get('/api/attachments');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/attachments/counts', () => {
    it('returns zero for unknown ownerIds', async () => {
      const res = await request(ctx.app)
        .get('/api/attachments/counts')
        .query({ ownerKind: 'local_issue', ownerIds: 'x,y,z' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { ownerKind: 'local_issue', ownerId: 'x', count: 0 },
        { ownerKind: 'local_issue', ownerId: 'y', count: 0 },
        { ownerKind: 'local_issue', ownerId: 'z', count: 0 },
      ]);
    });

    it('returns aggregated counts', async () => {
      for (const id of ['a', 'a', 'b']) {
        await request(ctx.app)
          .post('/api/attachments/json')
          .send({
            ownerKind: 'local_issue',
            ownerId: id,
            name: `${id}.png`,
            mimeType: 'image/png',
            data: Buffer.from(id).toString('base64'),
          });
      }
      const res = await request(ctx.app)
        .get('/api/attachments/counts')
        .query({ ownerKind: 'local_issue', ownerIds: 'a,b,c' });
      expect(res.status).toBe(200);
      const map = Object.fromEntries(
        res.body.data.map((c: { ownerId: string; count: number }) => [c.ownerId, c.count]),
      );
      expect(map).toEqual({ a: 2, b: 1, c: 0 });
    });
  });

  describe('GET /api/attachments/:id/raw', () => {
    it('streams the file with the original mime type and inline disposition', async () => {
      const upload = await request(ctx.app)
        .post('/api/attachments/json')
        .send({
          ownerKind: 'local_issue',
          ownerId: 'i-1',
          name: 'pic.png',
          mimeType: 'image/png',
          data: Buffer.from('IMG').toString('base64'),
        });
      const id = upload.body.data.id;

      const res = await request(ctx.app).get(`/api/attachments/${id}/raw`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^image\/png/);
      expect(res.headers['content-disposition']).toMatch(/^inline/);
      expect(res.body.toString()).toBe('IMG');
    });

    it('404 when attachment id does not exist', async () => {
      const res = await request(ctx.app).get('/api/attachments/missing/raw');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH and DELETE', () => {
    it('renames an attachment', async () => {
      const upload = await request(ctx.app)
        .post('/api/attachments/json')
        .send({
          ownerKind: 'local_issue',
          ownerId: 'i-1',
          name: 'old.png',
          mimeType: 'image/png',
          data: Buffer.from('x').toString('base64'),
        });
      const id = upload.body.data.id;

      const res = await request(ctx.app)
        .patch(`/api/attachments/${id}`)
        .send({ name: 'new.png', sortOrder: 5 });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('new.png');
      expect(res.body.data.sortOrder).toBe(5);
    });

    it('deletes an attachment', async () => {
      const upload = await request(ctx.app)
        .post('/api/attachments/json')
        .send({
          ownerKind: 'local_issue',
          ownerId: 'i-1',
          name: 'a.png',
          mimeType: 'image/png',
          data: Buffer.from('x').toString('base64'),
        });
      const id = upload.body.data.id;

      const del = await request(ctx.app).delete(`/api/attachments/${id}`);
      expect(del.status).toBe(200);

      const list = await request(ctx.app)
        .get('/api/attachments')
        .query({ ownerKind: 'local_issue', ownerId: 'i-1' });
      expect(list.body.data).toHaveLength(0);
    });
  });
});
