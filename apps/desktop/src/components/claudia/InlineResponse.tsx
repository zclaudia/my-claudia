import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { extractThinking } from '../chat/MessageList';
import type { InlineResponse as InlineResponseType } from '../../stores/claudiaStore';

interface InlineResponseProps {
  response: InlineResponseType;
  collapsed?: boolean;
}

export function InlineResponse({ response, collapsed }: InlineResponseProps) {
  const rawText = response.status === 'completed'
    ? response.responseText || ''
    : response.streamingText;
  const text = extractThinking(rawText).content.trim();
  const [manualExpand, setManualExpand] = useState(false);

  if (response.status === 'promoted') {
    return null;
  }

  // Collapsed mode
  if (collapsed && !manualExpand && response.status === 'completed') {
    const snippet = text.replace(/\n/g, ' ').slice(0, 80);
    return (
      <div
        className="rounded-lg bg-secondary/30 px-3 py-1.5 cursor-pointer hover:bg-secondary/50 transition-colors"
        onClick={() => setManualExpand(true)}
      >
        <p className="text-xs text-muted-foreground truncate">{snippet || 'Completed'}</p>
      </div>
    );
  }

  if (response.status === 'failed' && !text) {
    return (
      <div className="rounded-lg bg-secondary/30 px-3 py-2">
        <p className="text-xs text-red-400">{response.error || 'Request failed'}</p>
      </div>
    );
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
      {collapsed && manualExpand && (
        <button onClick={() => setManualExpand(false)} className="text-[10px] text-primary hover:underline mb-1">
          Collapse
        </button>
      )}
      <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1">
        <ReactMarkdown>{text}</ReactMarkdown>
        {response.status === 'streaming' && (
          <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
      {response.status === 'failed' && response.error && (
        <p className="mt-2 text-xs text-red-400">{response.error}</p>
      )}
    </div>
  );
}
