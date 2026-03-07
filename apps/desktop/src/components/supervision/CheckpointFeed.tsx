import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import type { SupervisionV2Log } from '@my-claudia/shared';
import * as api from '../../services/api';
import { useSupervisionStore } from '../../stores/supervisionStore';

interface CheckpointFeedProps {
  projectId: string;
}

export function CheckpointFeed({ projectId }: CheckpointFeedProps) {
  const [logs, setLogs] = useState<SupervisionV2Log[]>([]);
  const [loading, setLoading] = useState(false);
  const lastCheckpoint = useSupervisionStore((s) => s.lastCheckpoint[projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getSupervisionV2Logs(projectId, 50)
      .then((data) => {
        if (!cancelled) {
          // Filter for checkpoint-related events
          const checkpointLogs = data.filter((l) =>
            l.event === 'checkpoint_completed' ||
            l.event === 'context_updated' ||
            l.event === 'task_created',
          );
          setLogs(checkpointLogs);
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Checkpoints</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Latest checkpoint summary */}
        {lastCheckpoint && (
          <div className="px-3 py-2 border-b border-border/50">
            <span className="text-[10px] font-medium text-muted-foreground uppercase">Latest</span>
            <p className="text-xs mt-0.5 whitespace-pre-wrap">{lastCheckpoint}</p>
          </div>
        )}

        {/* Log entries */}
        {logs.length === 0 && !loading ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            No checkpoint activity yet
          </div>
        ) : (
          <div className="px-3 py-1">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
                <Clock size={10} className="text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">
                      {formatEventLabel(log.event)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDate(log.createdAt)} {formatTime(log.createdAt)}
                    </span>
                  </div>
                  {log.detail && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {typeof log.detail === 'object'
                        ? JSON.stringify(log.detail).slice(0, 100)
                        : String(log.detail)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatEventLabel(event: string): string {
  const labels: Record<string, string> = {
    checkpoint_completed: 'Checkpoint',
    knowledge_updated: 'Knowledge Updated',
    task_discovered: 'Task Discovered',
    task_started: 'Task Started',
    task_completed: 'Task Completed',
    task_failed: 'Task Failed',
    review_completed: 'Review Done',
    agent_initialized: 'Agent Init',
    phase_changed: 'Phase Changed',
    budget_paused: 'Budget Pause',
  };
  return labels[event] ?? event.replace(/_/g, ' ');
}
