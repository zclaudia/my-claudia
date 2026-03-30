import { useProjectStore } from '../stores/projectStore';
import { useSessionRoute } from './chat/useSessionRoute';

/**
 * Keeps the currently selected session subscribed to the facade run stream.
 * Without this, gateway-backed sessions only recover content after a later
 * HTTP sync, which makes tool events appear all at once on session switch or
 * run completion.
 */
export function useActiveSessionStream(): void {
  const selectedSessionId = useProjectStore((s) => s.selectedSessionId);
  useSessionRoute(selectedSessionId, { maintainDesiredState: true });
}
