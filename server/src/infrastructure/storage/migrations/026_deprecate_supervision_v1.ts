import type { Migration } from './types.js';

export const migration: Migration = {
  name: '026_deprecate_supervision_v1',
  sql: `
        ALTER TABLE supervisions RENAME TO supervisions_v1_archived;
        ALTER TABLE supervision_logs RENAME TO supervision_logs_v1_archived;
      `,
};
