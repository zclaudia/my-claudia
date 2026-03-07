import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { SupervisionTask, TaskStatus } from '@my-claudia/shared';
import { TaskCard } from './TaskCard';
import { TaskDetail } from './TaskDetail';
import { CreateTaskDialog } from './CreateTaskDialog';

interface TaskBoardProps {
  projectId: string;
  tasks: SupervisionTask[];
}

// Display order of status groups
const statusGroups: { key: string; statuses: TaskStatus[]; label: string }[] = [
  { key: 'needs_action', statuses: ['proposed', 'merge_conflict'], label: 'Needs Action' },
  { key: 'active', statuses: ['running', 'reviewing'], label: 'Active' },
  { key: 'queued', statuses: ['queued', 'pending'], label: 'Queued' },
  { key: 'done', statuses: ['integrated', 'approved'], label: 'Done' },
  { key: 'problem', statuses: ['rejected', 'failed', 'blocked', 'cancelled'], label: 'Issues' },
];

export function TaskBoard({ projectId, tasks }: TaskBoardProps) {
  const [selectedTask, setSelectedTask] = useState<SupervisionTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Group tasks by status category
  const groupedTasks = useMemo(() => {
    const groups: Record<string, SupervisionTask[]> = {};
    for (const group of statusGroups) {
      groups[group.key] = tasks.filter((t) => group.statuses.includes(t.status));
    }
    return groups;
  }, [tasks]);

  // Sort tasks within each group by priority
  const sortedGroups = useMemo(() => {
    return statusGroups
      .map((g) => ({
        ...g,
        tasks: (groupedTasks[g.key] ?? []).sort((a, b) => a.priority - b.priority),
      }))
      .filter((g) => g.tasks.length > 0);
  }, [groupedTasks]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Tasks</h3>
          <span className="text-xs text-muted-foreground">({tasks.length})</span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded"
        >
          <Plus size={12} /> Add Task
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No tasks yet. Click "Add Task" to create one.
          </div>
        ) : (
          sortedGroups.map((group) => (
            <div key={group.key}>
              <h4 className="text-xs font-medium text-muted-foreground uppercase mb-2">
                {group.label}
                <span className="ml-1 text-muted-foreground/50">({group.tasks.length})</span>
              </h4>
              <div className="space-y-1.5">
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onSelect={setSelectedTask}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Task detail drawer */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Create task dialog */}
      <CreateTaskDialog
        projectId={projectId}
        existingTasks={tasks}
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </div>
  );
}
