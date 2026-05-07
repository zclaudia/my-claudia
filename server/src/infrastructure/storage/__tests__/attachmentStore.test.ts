import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('attachmentStore (real fs)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Each test gets its own data dir so the singleton can be re-initialized.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudia-att-'));
    process.env.MY_CLAUDIA_DATA_DIR = tmpDir;
    // Reset module state between tests (singleton lives in module scope).
    const { vi } = await import('vitest');
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.MY_CLAUDIA_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initAttachmentStore creates the storage directory', async () => {
    const mod = await import('../attachmentStore.js');
    mod.initAttachmentStore();
    const expected = path.join(tmpDir, 'attachments');
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('storeFromBuffer writes file under bucketed path and computes sha256', async () => {
    const mod = await import('../attachmentStore.js');
    mod.initAttachmentStore();
    const store = mod.getAttachmentStore();

    const buf = Buffer.from('hello world');
    const meta = store.storeFromBuffer(buf);

    expect(meta.size).toBe(buf.length);
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.storageKey).toMatch(/^[a-f0-9]{2}\//);

    const abs = store.getPath(meta.storageKey);
    expect(abs).not.toBeNull();
    expect(fs.readFileSync(abs as string).toString()).toBe('hello world');
  });

  it('storeByMoving moves a temp file into the store', async () => {
    const mod = await import('../attachmentStore.js');
    mod.initAttachmentStore();
    const store = mod.getAttachmentStore();

    const tmpFile = path.join(tmpDir, 'src.bin');
    fs.writeFileSync(tmpFile, 'data');

    const meta = store.storeByMoving(tmpFile);
    expect(fs.existsSync(tmpFile)).toBe(false);
    const abs = store.getPath(meta.storageKey);
    expect(fs.readFileSync(abs as string).toString()).toBe('data');
  });

  it('delete removes the file and getPath returns null afterwards', async () => {
    const mod = await import('../attachmentStore.js');
    mod.initAttachmentStore();
    const store = mod.getAttachmentStore();

    const meta = store.storeFromBuffer(Buffer.from('x'));
    expect(store.getPath(meta.storageKey)).not.toBeNull();
    expect(store.delete(meta.storageKey)).toBe(true);
    expect(store.getPath(meta.storageKey)).toBeNull();
    // second delete is a no-op
    expect(store.delete(meta.storageKey)).toBe(false);
  });

  it('rejects path-traversal attempts in storage keys', async () => {
    const mod = await import('../attachmentStore.js');
    mod.initAttachmentStore();
    const store = mod.getAttachmentStore();

    expect(store.getPath('../etc/passwd')).toBeNull();
    expect(store.getPath('/etc/passwd')).toBeNull();
    expect(store.delete('../etc/passwd')).toBe(false);
  });

  it('getAttachmentStore throws before init', async () => {
    const mod = await import('../attachmentStore.js');
    expect(() => mod.getAttachmentStore()).toThrow('AttachmentStore not initialized');
  });
});
