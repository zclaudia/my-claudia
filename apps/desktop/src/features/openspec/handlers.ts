// apps/desktop/src/features/openspec/handlers.ts
//
// WebSocket message handler for the OpenSpec domain (G8). The server pushes
// three typed events when executor / sub-issue / spec-change status changes.
// On each event we refetch the affected entity from the API and update the
// store — this is cheap and gives us guaranteed consistency without depending
// on the event payload carrying every field the UI needs.

import type { ServerMessage } from '@my-claudia/shared';
import { useOpenSpecStore } from './store';
import * as api from './api';

/**
 * Handle openspec_* ServerMessage variants. Each handler triggers a small
 * refetch to keep the store accurate without depending on the event payload
 * being exhaustive. Returns true when the message was handled.
 */
export function handleOpenSpecMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'openspec_executor_status_changed': {
      const { specChangeId } = msg;
      // Refetch the executor list for this spec_change.
      api
        .listExecutors(specChangeId)
        .then((list) => useOpenSpecStore.getState().setExecutors(specChangeId, list))
        .catch(() => undefined);
      return true;
    }

    case 'openspec_sub_issue_status_changed': {
      const { subIssueId } = msg;
      api
        .getIssue(subIssueId)
        .then((issue) => useOpenSpecStore.getState().upsertIssue(issue))
        .catch(() => undefined);
      return true;
    }

    case 'openspec_spec_change_status_changed': {
      const { specChangeId } = msg;
      api
        .getSpecChange(specChangeId)
        .then((sc) => useOpenSpecStore.getState().setSpecChange(sc))
        .catch(() => undefined);
      return true;
    }

    default:
      return false;
  }
}
