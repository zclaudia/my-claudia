import ReactMarkdown from 'react-markdown';
import type { InlineResponse as InlineResponseType } from '../../stores/claudiaStore';

interface InlineResponseProps {
  response: InlineResponseType;
}

export function InlineResponse({ response }: InlineResponseProps) {
  const text = response.status === 'completed'
    ? response.responseText || ''
    : response.streamingText;

  if (response.status === 'promoted') {
    return null; // TaskCard handles this now
  }

  if (!text) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <span className="w-1.5 h-4 bg-foreground/40 animate-pulse" />
        <span>Thinking...</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-secondary/30 px-3 py-2">
      <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1">
        <ReactMarkdown>{text}</ReactMarkdown>
        {response.status === 'streaming' && (
          <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </div>
  );
}
