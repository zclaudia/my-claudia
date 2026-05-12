import type { ServerMessage } from '@my-claudia/shared';
import { useProjectStore } from '../../stores/projectStore';
import { useSystemTaskStore } from '../../stores/systemTaskStore';

export function handleSessionMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'sessions_created': {
      const { session } = msg as any;
      const store = useProjectStore.getState();
      if (!store.sessions.find((s: any) => s.id === session.id)) {
        store.addSession(session);
      }
      return true;
    }

    case 'sessions_updated': {
      const { session } = msg as any;
      useProjectStore.getState().updateSession(session.id, session);
      return true;
    }

    case 'system_task_update': {
      const { task } = msg as any;
      useSystemTaskStore.getState().updateTask(task);
      return true;
    }

    default:
      return false;
  }
}
