import type Database from 'better-sqlite3';
import { supportsAIReviewCliJob } from './review-job.js';

interface ProviderRow {
  id: string;
  name: string;
  type: string;
}

export function validateCliJobProviderId(
  db: Database.Database,
  providerId: string | undefined,
): string | null {
  if (!providerId) return null;

  const row = db.prepare(`
    SELECT id, name, type
    FROM providers
    WHERE id = ?
  `).get(providerId) as ProviderRow | undefined;

  if (!row) {
    return 'Selected AI review provider was not found.';
  }

  if (!supportsAIReviewCliJob(row.type)) {
    return `Provider "${row.name}" (${row.type}) does not support cli-jobs and cannot be used for AI review.`;
  }

  return null;
}
