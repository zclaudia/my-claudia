import type Database from 'better-sqlite3';
import { ProviderRepository } from './repository.js';

export class ProviderNotFoundError extends Error {
  constructor(providerId: string) {
    super(`Provider not found: ${providerId}`);
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderDeletionService {
  private readonly repo: ProviderRepository;

  constructor(private readonly db: Database.Database) {
    this.repo = new ProviderRepository(db);
  }

  deleteProvider(providerId: string): void {
    const existing = this.repo.findById(providerId);
    if (!existing) {
      throw new ProviderNotFoundError(providerId);
    }

    const deleteProviderTx = this.db.transaction(() => {
      this.clearProviderReferences(providerId);

      if (!this.repo.delete(providerId)) {
        throw new ProviderNotFoundError(providerId);
      }

      if (!existing.isDefault) {
        return;
      }

      const replacement = this.findReplacementProviderId();
      if (replacement) {
        this.repo.setDefault(replacement);
      }
    });

    deleteProviderTx();
  }

  private clearProviderReferences(providerId: string): void {
    this.db.prepare('UPDATE projects SET provider_id = NULL WHERE provider_id = ?').run(providerId);
    this.db.prepare('UPDATE sessions SET provider_id = NULL WHERE provider_id = ?').run(providerId);

    if (this.hasColumn('projects', 'review_provider_id')) {
      this.db.prepare('UPDATE projects SET review_provider_id = NULL WHERE review_provider_id = ?').run(providerId);
    }

    if (this.hasColumn('agent_config', 'provider_id')) {
      this.db.prepare('UPDATE agent_config SET provider_id = NULL WHERE provider_id = ?').run(providerId);
    }
  }

  private hasColumn(table: string, column: string): boolean {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return columns.some((col) => col.name === column);
  }

  private findReplacementProviderId(): string | null {
    const replacement = this.db.prepare(`
      SELECT id FROM providers
      ORDER BY created_at ASC
      LIMIT 1
    `).get() as { id: string } | undefined;

    return replacement?.id ?? null;
  }
}
