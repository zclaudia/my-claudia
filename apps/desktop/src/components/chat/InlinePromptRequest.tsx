import { useState, useCallback } from 'react';
import { MessageCircleQuestion, Send, X } from 'lucide-react';
import type { PromptRequest } from '../../stores/promptRequestStore';

interface InlinePromptRequestProps {
  request: PromptRequest;
  onAnswer: (requestId: string, formattedAnswer: string) => void;
}

export function InlinePromptRequest({ request, onAnswer }: InlinePromptRequestProps) {
  const [selections, setSelections] = useState<Record<number, Set<string>>>({});
  const [resolved, setResolved] = useState(false);

  const toggle = useCallback((qIdx: number, label: string, multiSelect: boolean) => {
    setSelections(prev => {
      const current = prev[qIdx] ?? new Set<string>();
      const next = new Set(current);
      if (multiSelect) {
        if (next.has(label)) next.delete(label);
        else next.add(label);
      } else {
        next.clear();
        next.add(label);
      }
      return { ...prev, [qIdx]: next };
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (!request.questions.length) {
      onAnswer(request.requestId, 'No questions to answer.');
      setResolved(true);
      return;
    }
    const parts = request.questions.map((q, idx) => {
      const selected = selections[idx];
      const answer = selected && selected.size > 0
        ? [...selected].join(', ')
        : '(No selection)';
      return `Q: ${q.question}\nA: ${answer}`;
    });
    onAnswer(request.requestId, parts.join('\n\n'));
    setResolved(true);
  }, [request, selections, onAnswer]);

  const handleSkip = useCallback(() => {
    onAnswer(request.requestId, '(Skipped)');
    setResolved(true);
  }, [request.requestId, onAnswer]);

  if (resolved) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-xs text-success">
        <MessageCircleQuestion size={14} className="flex-shrink-0" />
        <span>Response submitted</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden border-l-4 border-l-primary">
      {/* Header */}
      <div className="px-3 py-2 bg-card flex items-center gap-2">
        <MessageCircleQuestion size={16} strokeWidth={2} className="text-primary flex-shrink-0" />
        <span className="text-sm font-medium text-card-foreground">
          Question{request.questions.length > 1 ? 's' : ''}
        </span>
        {request.backendName && (
          <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            {request.backendName}
          </span>
        )}
      </div>

      {/* Questions */}
      <div className="px-3 py-2 border-t border-border/50 space-y-3">
        {request.questions.map((q, qIdx) => {
          const selected = selections[qIdx] ?? new Set<string>();
          return (
            <div key={qIdx}>
              <div className="flex items-start gap-2 mb-1.5">
                <span className="inline-block px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded font-medium flex-shrink-0">
                  {q.header}
                </span>
                <span className="text-xs text-foreground">{q.question}</span>
              </div>
              <div className="ml-2 space-y-1">
                {q.options.map((opt) => {
                  const isSelected = selected.has(opt.label);
                  return (
                    <label
                      key={opt.label}
                      className={`flex items-start gap-2 p-1.5 rounded cursor-pointer transition-colors text-xs ${
                        isSelected
                          ? 'bg-primary/10 border border-primary/30'
                          : 'bg-muted/30 border border-transparent hover:bg-muted/50'
                      }`}
                    >
                      <input
                        type={q.multiSelect ? 'checkbox' : 'radio'}
                        name={`q-${request.requestId}-${qIdx}`}
                        checked={isSelected}
                        onChange={() => toggle(qIdx, opt.label, !!q.multiSelect)}
                        className="mt-0.5 w-3.5 h-3.5 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-foreground">{opt.label}</span>
                        {opt.description && (
                          <span className="text-muted-foreground ml-1">— {opt.description}</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Actions */}
        <div className="flex items-center gap-2 justify-end pt-1">
          <button
            onClick={handleSkip}
            className="flex items-center gap-1 px-3 py-1.5 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-secondary-foreground rounded-full text-xs font-medium transition-colors"
          >
            <X size={10} />
            Skip
          </button>
          <button
            onClick={handleSubmit}
            className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground rounded-full text-xs font-medium transition-colors"
          >
            <Send size={10} />
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
