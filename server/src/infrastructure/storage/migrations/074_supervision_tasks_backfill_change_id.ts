import type { Migration } from './types.js';

/**
 * C3 — backfill `supervision_tasks.change_id` so the C3 invariant
 * ("every Task belongs to a Change") holds for legacy rows.
 *
 * Before C3, `SupervisorService.createTask` wrote the placeholder string
 * `'legacy-default'` when no Change was provided. We replace those (and any
 * remaining NULLs from migration 064) with the per-project "Ad-hoc Tasks"
 * Change (slug = `ad-hoc-tasks`, `active = 0`). The Ad-hoc Change is a
 * bookkeeping bucket — no scaffolded artifacts, no gate workflow.
 *
 * The DB column itself is left nullable (adding NOT NULL on SQLite requires
 * a full table rebuild and the `supervision_tasks` schema is large + has
 * many add-on columns). The invariant is enforced at the type level
 * (`SupervisionTask.changeId: string`) and business layer
 * (`SupervisorService.createTask` always resolves a Change before insert).
 */
export const migration: Migration = {
  name: '074_supervision_tasks_backfill_change_id',
  sql: `
    -- 1. Create a per-project Ad-hoc Change for every project that currently
    --    has orphan tasks (change_id is NULL or the legacy 'legacy-default'
    --    placeholder), unless one already exists.
    INSERT INTO project_changes (
      id, project_id, slug, title, summary,
      non_goals, scope, acceptance_criteria,
      status, active, created_at, updated_at
    )
    SELECT
      lower(hex(randomblob(16))),
      orphan_projects.project_id,
      'ad-hoc-tasks',
      'Ad-hoc Tasks',
      'Auto-created holder for tasks not attached to an explicit Change. Created by migration 074.',
      '[]', '[]', '[]',
      'draft', 0,
      CAST(strftime('%s', 'now') AS INTEGER) * 1000,
      CAST(strftime('%s', 'now') AS INTEGER) * 1000
    FROM (
      SELECT DISTINCT project_id
      FROM supervision_tasks
      WHERE change_id IS NULL OR change_id = 'legacy-default'
    ) AS orphan_projects
    WHERE NOT EXISTS (
      SELECT 1 FROM project_changes pc
      WHERE pc.project_id = orphan_projects.project_id
        AND pc.slug = 'ad-hoc-tasks'
    );

    -- 2. Repoint orphan tasks to their project's Ad-hoc Change.
    UPDATE supervision_tasks
    SET change_id = (
      SELECT id FROM project_changes
      WHERE project_changes.project_id = supervision_tasks.project_id
        AND project_changes.slug = 'ad-hoc-tasks'
      LIMIT 1
    )
    WHERE change_id IS NULL OR change_id = 'legacy-default';
  `,
};
