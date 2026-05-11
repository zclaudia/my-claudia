import type { Migration } from './types.js';

import { migration as m_001_initial_schema } from './001_initial_schema.js';
import { migration as m_002_gateway_config } from './002_gateway_config.js';
import { migration as m_003_servers_table } from './003_servers_table.js';
import { migration as m_004_proxy_support } from './004_proxy_support.js';
import { migration as m_005_messages_fts } from './005_messages_fts.js';
import { migration as m_006_register_as_backend } from './006_register_as_backend.js';
import { migration as m_007_search_history } from './007_search_history.js';
import { migration as m_008_extended_search } from './008_extended_search.js';
import { migration as m_009_fix_messages_fts_triggers } from './009_fix_messages_fts_triggers.js';
import { migration as m_010_cleanup_legacy_provider_types } from './010_cleanup_legacy_provider_types.js';
import { migration as m_011_fix_orphaned_fts_rows } from './011_fix_orphaned_fts_rows.js';
import { migration as m_012_agent_config } from './012_agent_config.js';
import { migration as m_013_agent_provider_id } from './013_agent_provider_id.js';
import { migration as m_014_session_type_and_parent } from './014_session_type_and_parent.js';
import { migration as m_015_project_agent_permission_override } from './015_project_agent_permission_override.js';
import { migration as m_016_project_is_internal } from './016_project_is_internal.js';
import { migration as m_017_session_archived_at } from './017_session_archived_at.js';
import { migration as m_018_supervisions } from './018_supervisions.js';
import { migration as m_019_notification_config } from './019_notification_config.js';
import { migration as m_020_fix_imported_opencode_sessions } from './020_fix_imported_opencode_sessions.js';
import { migration as m_021_files_table } from './021_files_table.js';
import { migration as m_022_supervision_planning } from './022_supervision_planning.js';
import { migration as m_023_message_offset } from './023_message_offset.js';
import { migration as m_024_session_working_directory } from './024_session_working_directory.js';
import { migration as m_025_supervision_v2 } from './025_supervision_v2.js';
import { migration as m_026_deprecate_supervision_v1 } from './026_deprecate_supervision_v1.js';
import { migration as m_027_session_plan_status } from './027_session_plan_status.js';
import { migration as m_028_lite_supervisor_scheduling } from './028_lite_supervisor_scheduling.js';
import { migration as m_029_mcp_servers } from './029_mcp_servers.js';
import { migration as m_030_local_pr_workflow } from './030_local_pr_workflow.js';
import { migration as m_031_scheduled_tasks } from './031_scheduled_tasks.js';
import { migration as m_032_local_pr_auto_review } from './032_local_pr_auto_review.js';
import { migration as m_033_worktree_configs } from './033_worktree_configs.js';
import { migration as m_034_session_run_status } from './034_session_run_status.js';
import { migration as m_035_workflows } from './035_workflows.js';
import { migration as m_036_local_pr_status_message } from './036_local_pr_status_message.js';
import { migration as m_037_local_pr_merge_commit_sha } from './037_local_pr_merge_commit_sha.js';
import { migration as m_038_local_pr_execution_state } from './038_local_pr_execution_state.js';
import { migration as m_039_task_runs } from './039_task_runs.js';
import { migration as m_040_session_drafts } from './040_session_drafts.js';
import { migration as m_041_app_config } from './041_app_config.js';
import { migration as m_042_rename_supervision_logs } from './042_rename_supervision_logs.js';
import { migration as m_043_session_type_agent } from './043_session_type_agent.js';
import { migration as m_044_orchestrator_tasks } from './044_orchestrator_tasks.js';
import { migration as m_045_agent_assistant_memory } from './045_agent_assistant_memory.js';
import { migration as m_046_agent_feed } from './046_agent_feed.js';
import { migration as m_047_delegation_config } from './047_delegation_config.js';
import { migration as m_048_agent_trigger_schedule_fields } from './048_agent_trigger_schedule_fields.js';
import { migration as m_049_orchestrator_task_initiator } from './049_orchestrator_task_initiator.js';
import { migration as m_050_permission_memories } from './050_permission_memories.js';
import { migration as m_051_permission_outside_workspace_roots } from './051_permission_outside_workspace_roots.js';
import { migration as m_052_claudia_host_project } from './052_claudia_host_project.js';
import { migration as m_053_claudia_branches } from './053_claudia_branches.js';
import { migration as m_054_claudia_project_state } from './054_claudia_project_state.js';
import { migration as m_055_claudia_task_metadata } from './055_claudia_task_metadata.js';
import { migration as m_056_global_workflows } from './056_global_workflows.js';
import { migration as m_057_sort_order } from './057_sort_order.js';
import { migration as m_058_rename_agent_feed_to_notifications } from './058_rename_agent_feed_to_notifications.js';
import { migration as m_059_workflow_metadata } from './059_workflow_metadata.js';
import { migration as m_060_managed_processes } from './060_managed_processes.js';
import { migration as m_061_system_permission_workflow } from './061_system_permission_workflow.js';
import { migration as m_062_permission_workflow_overrides } from './062_permission_workflow_overrides.js';
import { migration as m_063_notification_initiator } from './063_notification_initiator.js';
import { migration as m_064_supervisor_changes_v1 } from './064_supervisor_changes_v1.js';
import { migration as m_065_local_issues } from './065_local_issues.js';
import { migration as m_066_attachments } from './066_attachments.js';
import { migration as m_067_turn_summaries } from './067_turn_summaries.js';

export type { Migration };

export const migrations: Migration[] = [
  m_001_initial_schema,
  m_002_gateway_config,
  m_003_servers_table,
  m_004_proxy_support,
  m_005_messages_fts,
  m_006_register_as_backend,
  m_007_search_history,
  m_008_extended_search,
  m_009_fix_messages_fts_triggers,
  m_010_cleanup_legacy_provider_types,
  m_011_fix_orphaned_fts_rows,
  m_012_agent_config,
  m_013_agent_provider_id,
  m_014_session_type_and_parent,
  m_015_project_agent_permission_override,
  m_016_project_is_internal,
  m_017_session_archived_at,
  m_018_supervisions,
  m_019_notification_config,
  m_020_fix_imported_opencode_sessions,
  m_021_files_table,
  m_022_supervision_planning,
  m_023_message_offset,
  m_024_session_working_directory,
  m_025_supervision_v2,
  m_026_deprecate_supervision_v1,
  m_027_session_plan_status,
  m_028_lite_supervisor_scheduling,
  m_029_mcp_servers,
  m_030_local_pr_workflow,
  m_031_scheduled_tasks,
  m_032_local_pr_auto_review,
  m_033_worktree_configs,
  m_034_session_run_status,
  m_035_workflows,
  m_036_local_pr_status_message,
  m_037_local_pr_merge_commit_sha,
  m_038_local_pr_execution_state,
  m_039_task_runs,
  m_040_session_drafts,
  m_041_app_config,
  m_042_rename_supervision_logs,
  m_043_session_type_agent,
  m_044_orchestrator_tasks,
  m_045_agent_assistant_memory,
  m_046_agent_feed,
  m_047_delegation_config,
  m_048_agent_trigger_schedule_fields,
  m_049_orchestrator_task_initiator,
  m_050_permission_memories,
  m_051_permission_outside_workspace_roots,
  m_052_claudia_host_project,
  m_053_claudia_branches,
  m_054_claudia_project_state,
  m_055_claudia_task_metadata,
  m_056_global_workflows,
  m_057_sort_order,
  m_058_rename_agent_feed_to_notifications,
  m_059_workflow_metadata,
  m_060_managed_processes,
  m_061_system_permission_workflow,
  m_062_permission_workflow_overrides,
  m_063_notification_initiator,
  m_064_supervisor_changes_v1,
  m_065_local_issues,
  m_066_attachments,
  m_067_turn_summaries,
];
