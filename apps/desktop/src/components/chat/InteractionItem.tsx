import { memo } from 'react';
import { CheckCircle2, Loader2, Square, ListTodo, MessageCircleQuestion } from 'lucide-react';
import type { InteractionMessage } from '@my-claudia/shared';

interface InteractionItemProps {
  interaction: InteractionMessage;
}

function InteractionItemInner({ interaction }: InteractionItemProps) {
  if (interaction.type === 'interaction_todo_update') {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 rounded-md bg-muted/30 border border-border/50">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <ListTodo size={12} />
          <span>Task List</span>
        </div>
        <div className="space-y-1">
          {interaction.todos.map((todo, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="flex-shrink-0">
                {todo.status === 'completed' ? (
                  <CheckCircle2 size={12} className="text-success" />
                ) : todo.status === 'in_progress' ? (
                  <Loader2 size={12} className="animate-spin text-primary" />
                ) : (
                  <Square size={12} className="text-muted-foreground" />
                )}
              </span>
              <span className={todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                {todo.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (interaction.type === 'interaction_ask_user') {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 rounded-md bg-muted/30 border border-border/50">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <MessageCircleQuestion size={12} />
          <span>Question</span>
        </div>
        <div className="space-y-1">
          {interaction.questions.map((q, idx) => (
            <div key={idx} className="text-xs text-foreground">
              {q.question}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

export const InteractionItem = memo(InteractionItemInner);
