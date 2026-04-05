import { BaseRepository } from '../../repositories/base.js';
import type { Database } from 'better-sqlite3';
import type { ProviderConfig } from '@my-claudia/shared';
import { v4 as uuidv4 } from 'uuid';

export class ProviderRepository extends BaseRepository<
  ProviderConfig,
  Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>,
  Partial<Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>>
> {
  constructor(db: Database) {
    super(db, 'providers');
  }

  mapRow(row: any): ProviderConfig {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      cliPath: row.cli_path || undefined,
      env: row.env ? JSON.parse(row.env) : undefined,
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createQuery(data: Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>): { sql: string; params: any[] } {
    const id = uuidv4();
    const now = Date.now();

    return {
      sql: `
        INSERT INTO providers (id, name, type, cli_path, env, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        id,
        data.name,
        data.type || 'claude',
        data.cliPath || null,
        data.env ? JSON.stringify(data.env) : null,
        data.isDefault ? 1 : 0,
        now,
        now,
      ],
    };
  }

  updateQuery(id: string, data: Partial<Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>>): { sql: string; params: any[] } {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      params.push(data.name);
    }
    if (data.type !== undefined) {
      updates.push('type = ?');
      params.push(data.type);
    }
    if (data.cliPath !== undefined) {
      updates.push('cli_path = ?');
      params.push(data.cliPath);
    }
    if (data.env !== undefined) {
      updates.push('env = ?');
      params.push(data.env ? JSON.stringify(data.env) : null);
    }
    if (data.isDefault !== undefined) {
      updates.push('is_default = ?');
      params.push(data.isDefault ? 1 : 0);
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    return {
      sql: `UPDATE providers SET ${updates.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findDefault(): ProviderConfig | null {
    const row = this.db.prepare(`
      SELECT * FROM providers
      WHERE is_default = 1
      LIMIT 1
    `).get();
    return row ? this.mapRow(row) : null;
  }

  findAllOrdered(): ProviderConfig[] {
    const rows = this.db.prepare(`
      SELECT * FROM providers
      ORDER BY is_default DESC, name ASC
    `).all();
    return rows.map((row) => this.mapRow(row));
  }

  clearAllDefaults(): void {
    this.db.prepare('UPDATE providers SET is_default = 0').run();
  }

  clearDefaultsExcept(id: string): void {
    this.db.prepare('UPDATE providers SET is_default = 0 WHERE id != ?').run(id);
  }

  setDefault(id: string): ProviderConfig {
    this.db.prepare('UPDATE providers SET is_default = 0').run();

    const result = this.db.prepare(`
      UPDATE providers SET is_default = 1, updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);

    if (result.changes === 0) {
      throw new Error(`Provider not found: ${id}`);
    }

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Failed to set default provider: ${id}`);
    }
    return updated;
  }
}
