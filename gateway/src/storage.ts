import Database from 'better-sqlite3';
import crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const DATA_DIR = process.env.MY_CLAUDIA_DATA_DIR
  ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR, 'gateway')
  : path.join(os.homedir(), '.my-claudia', 'gateway');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'gateway.db');

export interface DeviceMapping {
  deviceId: string;
  backendId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export function initDatabase(): Database.Database {
  const db = new Database(DB_PATH);

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
  `);

  return db;
}

export class GatewayStorage {
  private db: Database.Database;

  constructor() {
    this.db = initDatabase();
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
