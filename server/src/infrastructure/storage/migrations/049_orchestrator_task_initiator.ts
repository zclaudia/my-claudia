import type { Migration } from './types.js';

export const migration: Migration = {
  name: '049_orchestrator_task_initiator',
  idempotent: true,
  sql: `
        ALTER TABLE orchestrator_tasks ADD COLUMN initiator TEXT NOT NULL DEFAULT 'system';
        UPDATE orchestrator_tasks
        SET initiator = 'claudia'
        WHERE id IN (
          SELECT task_id
          FROM agent_feed
          WHERE source = 'manual' AND task_id IS NOT NULL
        )
        OR root_task_id IN (
          SELECT task_id
          FROM agent_feed
          WHERE source = 'manual' AND task_id IS NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orch_tasks_initiator ON orchestrator_tasks(initiator);
      `,
};
