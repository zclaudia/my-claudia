import Database from 'better-sqlite3';
import crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

function getDataDir(): string {
  return process.env.MY_CLAUDIA_DATA_DIR
    ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR, 'gateway')
    : path.join(os.homedir(), '.my-claudia', 'gateway');
}

function getDbPath(): string {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'gateway.db');
}

export interface DeviceMapping {
  deviceId: string;
  backendId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface InstanceMapping {
  instanceId: string;
  deviceId: string;
  backendId: string;
  channel: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export function initDatabase(dbPath: string = getDbPath()): Database.Database {
  const db = new Database(dbPath);

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS device_mappings (
      device_id TEXT PRIMARY KEY,
      backend_id TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_backend_id ON device_mappings(backend_id);

    CREATE TABLE IF NOT EXISTS instance_mappings (
      instance_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      backend_id TEXT UNIQUE NOT NULL,
      channel TEXT,
      name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_instance_backend_id ON instance_mappings(backend_id);
    CREATE INDEX IF NOT EXISTS idx_instance_device_id ON instance_mappings(device_id);
  `);

  return db;
}

export class GatewayStorage {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = initDatabase(dbPath);
  }

  /**
   * Get or create a backendId for a deviceId
   * If the deviceId already exists, return the existing backendId
   * If not, create a new backendId and store the mapping
   */
  getOrCreateBackendId(deviceId: string, name?: string): string {
    const existing = this.db.prepare(`
      SELECT backend_id, name FROM device_mappings WHERE device_id = ?
    `).get(deviceId) as { backend_id: string; name: string } | undefined;

    if (existing) {
      // Update name if provided and different
      if (name && name !== existing.name) {
        this.db.prepare(`
          UPDATE device_mappings SET name = ?, updated_at = ? WHERE device_id = ?
        `).run(name, Date.now(), deviceId);
      }
      return existing.backend_id;
    }

    // Generate a new backendId (short, URL-safe)
    const backendId = this.generateBackendId();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO device_mappings (device_id, backend_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(deviceId, backendId, name || null, now, now);

    return backendId;
  }

  /**
   * Get or create a backendId by instanceId (supports same device with multiple channels)
   * If instanceId exists in instance_mappings, return existing backendId.
   * If not, try to migrate from device_mappings (one-time migration for existing devices).
   * Otherwise, generate a new backendId.
   */
  getOrCreateBackendIdByInstance(instanceId: string, deviceId: string, channel?: string, name?: string): string {
    const existing = this.db.prepare(`
      SELECT backend_id, name FROM instance_mappings WHERE instance_id = ?
    `).get(instanceId) as { backend_id: string; name: string } | undefined;

    if (existing) {
      if (name && name !== existing.name) {
        this.db.prepare(`
          UPDATE instance_mappings SET name = ?, updated_at = ? WHERE instance_id = ?
        `).run(name, Date.now(), instanceId);
      }
      return existing.backend_id;
    }

    // Try to migrate from device_mappings (one-time migration for the default channel)
    const ch = channel || 'prod';
    if (ch === 'prod') {
      const legacy = this.db.prepare(`
        SELECT backend_id, name FROM device_mappings WHERE device_id = ?
      `).get(deviceId) as { backend_id: string; name: string } | undefined;

      // Only migrate if this backendId is not already claimed by another instance
      if (legacy) {
        const alreadyMigrated = this.db.prepare(`
          SELECT 1 FROM instance_mappings WHERE backend_id = ?
        `).get(legacy.backend_id);

        if (!alreadyMigrated) {
          const now = Date.now();
          this.db.prepare(`
            INSERT INTO instance_mappings (instance_id, device_id, backend_id, channel, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(instanceId, deviceId, legacy.backend_id, ch, name || legacy.name || null, now, now);
          return legacy.backend_id;
        }
      }
    }

    // Generate new backendId
    const backendId = this.generateBackendId();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO instance_mappings (instance_id, device_id, backend_id, channel, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(instanceId, deviceId, backendId, ch, name || null, now, now);

    return backendId;
  }

  /**
   * Get instance info by backendId
   */
  getInstanceByBackendId(backendId: string): InstanceMapping | undefined {
    return this.db.prepare(`
      SELECT instance_id as instanceId, device_id as deviceId, backend_id as backendId,
             channel, name, created_at as createdAt, updated_at as updatedAt
      FROM instance_mappings WHERE backend_id = ?
    `).get(backendId) as InstanceMapping | undefined;
  }

  /**
   * Get device info by backendId
   */
  getDeviceByBackendId(backendId: string): DeviceMapping | undefined {
    const row = this.db.prepare(`
      SELECT device_id as deviceId, backend_id as backendId, name,
             created_at as createdAt, updated_at as updatedAt
      FROM device_mappings WHERE backend_id = ?
    `).get(backendId) as DeviceMapping | undefined;

    return row;
  }

  /**
   * Generate a short, URL-safe backendId
   */
  private generateBackendId(): string {
    return crypto.randomBytes(4).toString('hex');
  }

  close(): void {
    this.db.close();
  }
}
