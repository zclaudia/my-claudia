import { BaseRepository } from './base.js';
import type { Database } from 'better-sqlite3';
import type { BackendServer } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * Repository for BackendServer entity (servers table)
 *
 * Handles all database operations for backend servers, including:
 * - Field mapping between snake_case (DB) and camelCase (TypeScript)
 * - Boolean conversion for is_default and requires_auth (INTEGER 0/1)
 * - Connection mode and gateway configuration
 * - Timestamp management
 */
export class ServerRepository extends BaseRepository<
  BackendServer,
  Omit<BackendServer, 'id' | 'createdAt'>,
  Partial<Omit<BackendServer, 'id' | 'createdAt'>>
> {
  constructor(db: Database) {
    super(db, 'servers');
  }

  /**
   * Map database row (snake_case) to BackendServer entity (camelCase)
   */
  mapRow(row: any): BackendServer {
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      isDefault: row.is_default === 1,
      lastConnected: row.last_connected,
      createdAt: row.created_at,
      clientId: row.client_id,
      connectionMode: row.connection_mode
    };
  }

  /**
   * Generate INSERT query for new server
   */
  createQuery(data: Omit<BackendServer, 'id' | 'createdAt'>): { sql: string; params: any[] } {
    const id = uuidv4();
    const now = Date.now();

    return {
      sql: `
        INSERT INTO servers (
          id, name, address, connection_mode,
          api_key, client_id, is_default, requires_auth,
          created_at, updated_at, last_connected
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.name,
        data.address,
        data.connectionMode || 'direct',
        null,  // api_key (deprecated)
        data.clientId || null,
        data.isDefault ? 1 : 0,
        0,  // requires_auth (deprecated)
        now,
        now,
        data.lastConnected || null
      ]
    };
  }

  /**
   * Generate UPDATE query for existing server
   */
  updateQuery(id: string, data: Partial<Omit<BackendServer, 'id' | 'createdAt'>>): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    // Build dynamic UPDATE query based on provided fields
    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.address !== undefined) {
      updates.push('address = ?');
      params.push(data.address);
    }
    if (data.connectionMode !== undefined) {
      updates.push('connection_mode = ?');
      params.push(data.connectionMode);
    }
    if (data.clientId !== undefined) {
      updates.push('client_id = ?');
      params.push(data.clientId);
    }
    if (data.isDefault !== undefined) {
      updates.push('is_default = ?');
      params.push(data.isDefault ? 1 : 0);
    }
    if (data.lastConnected !== undefined) {
      updates.push('last_connected = ?');
      params.push(data.lastConnected);
    }

    // Always update timestamp
    updates.push('updated_at = ?');
    params.push(Date.now());

    // Add ID as last parameter
    params.push(id);

    return {
      sql: `UPDATE servers SET ${updates.join(', ')} WHERE id = ?`,
      params
    };
  }

  /**
   * Find the default server
   */
  findDefault(): BackendServer | null {
    const row = this.db.prepare(`
      SELECT * FROM servers
      WHERE is_default = 1
      LIMIT 1
    `).get();
    return row ? this.mapRow(row) : null;
  }

  /**
   * Set a server as default (and unset all others)
   */
  setDefault(id: string): BackendServer {
    // Unset all defaults first
    this.db.prepare(`UPDATE servers SET is_default = 0`).run();

    // Set the specified server as default
    const result = this.db.prepare(`
      UPDATE servers SET is_default = 1, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);

    if (result.changes === 0) {
      throw new Error(`Server not found: ${id}`);
    }

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Failed to set default server: ${id}`);
    }
    return updated;
  }

  /**
   * Update last connected timestamp
   */
  updateLastConnected(id: string): void {
    this.db.prepare(`
      UPDATE servers SET last_connected = ?, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), Date.now(), id);
  }
}
