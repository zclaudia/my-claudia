import type { Database } from 'better-sqlite3';

/**
 * Generic repository interface for CRUD operations
 */
export interface Repository<T, TCreate, TUpdate> {
  findAll(): T[];
  findById(id: string): T | null;
  create(data: TCreate): T;
  update(id: string, data: TUpdate): T;
  delete(id: string): boolean;
}

/**
 * Base repository class implementing common CRUD operations
 *
 * This class eliminates SQL duplication across handlers by providing
 * a single source of truth for database operations. Subclasses only need
 * to implement field mapping and query generation specific to their entity.
 *
 * Benefits:
 * - DRY: No SQL duplication
 * - Type-safe: Full TypeScript support
 * - Testable: Can test in isolation
 * - Maintainable: Single place to update DB logic
 */
export abstract class BaseRepository<T, TCreate, TUpdate> implements Repository<T, TCreate, TUpdate> {
  constructor(
    protected db: Database,
    protected tableName: string
  ) {}

  /**
   * Map a database row to entity type
   * Subclasses must implement this to handle snake_case ↔ camelCase conversion
   */
  // Row parameter uses Record<string, unknown> but declared as `unknown` to avoid
  // needing to cast every `.all()` / `.get()` call site in subclass finder methods.
  abstract mapRow(row: unknown): T;

  /**
   * Generate SQL and parameters for create operation
   * Subclasses implement entity-specific field mapping
   */
  abstract createQuery(data: TCreate): { sql: string; params: unknown[] };

  /**
   * Generate SQL and parameters for update operation
   * Subclasses implement entity-specific field mapping
   */
  abstract updateQuery(id: string, data: TUpdate): { sql: string; params: unknown[] };

  /**
   * Find all entities
   */
  findAll(): T[] {
    const rows = this.db.prepare(`SELECT * FROM ${this.tableName}`).all();
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Find entity by ID
   */
  findById(id: string): T | null {
    const row = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id);
    return row ? this.mapRow(row) : null;
  }

  /**
   * Create new entity
   */
  create(data: TCreate): T {
    const { sql, params } = this.createQuery(data);
    this.db.prepare(sql).run(...params);
    // Return the created entity by ID (first param is always the ID)
    const created = this.findById(params[0] as string);
    if (!created) {
      throw new Error(`Failed to create ${this.tableName}`);
    }
    return created;
  }

  /**
   * Update existing entity
   */
  update(id: string, data: TUpdate): T {
    const { sql, params } = this.updateQuery(id, data);
    const result = this.db.prepare(sql).run(...params);

    if (result.changes === 0) {
      throw new Error(`${this.tableName} not found: ${id}`);
    }

    const updated = this.findById(id);
    if (!updated) {
      throw new Error(`Failed to update ${this.tableName}: ${id}`);
    }
    return updated;
  }

  /**
   * Delete entity by ID
   */
  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
    return result.changes > 0;
  }
}
