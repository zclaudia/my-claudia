import { useState, useEffect } from 'react';
import type { AskUserQuestionItem } from '@my-claudia/shared';
import type { AskUserQuestionRequest } from '../../stores/askUserQuestionStore';

interface InlineAskUserQuestionProps {
  request: AskUserQuestionRequest;
  onAnswer: (requestId: string, formattedAnswer: string) => void;
}

interface QuestionAnswer {
  selected: Set<string>;
  otherText: string;
  useOther: boolean;
}

function formatAnswers(questions: AskUserQuestionItem[], answers: QuestionAnswer[]): string {
  return questions.map((q, i) => {
    const answer = answers[i];
    const parts: string[] = [];
    for (const label of answer.selected) {
      parts.push(label);
    }
    if (answer.useOther && answer.otherText.trim()) {
      parts.push(answer.otherText.trim());
    }
    const answerText = parts.length > 0 ? parts.join(', ') : 'No answer';
    return `Q: ${q.question}\nA: ${answerText}`;
  }).join('\n\n');
}

export function InlineAskUserQuestion({ request, onAnswer }: InlineAskUserQuestionProps) {
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [resolved, setResolved] = useState(false);
  const [resolvedText, setResolvedText] = useState('');

  useEffect(() => {
    setAnswers(
      request.questions.map(() => ({
        selected: new Set<string>(),
        otherText: '',
        useOther: false,
      }))
    );
    setResolved(false);
  }, [request.requestId]);

  if (answers.length === 0) return null;

  const handleOptionToggle = (questionIdx: number, label: string) => {
    setAnswers(prev => {
      const updated = [...prev];
      const answer = { ...updated[questionIdx], selected: new Set(updated[questionIdx].selected) };
      const isMulti = request.questions[questionIdx].multiSelect;

      if (isMulti) {
        if (answer.selected.has(label)) {
          answer.selected.delete(label);
        } else {
          answer.selected.add(label);
        }
      } else {
        answer.selected.clear();
        answer.selected.add(label);
        answer.useOther = false;
      }

      updated[questionIdx] = answer;
      return updated;
    });
  };

  const handleOtherToggle = (questionIdx: number) => {
    setAnswers(prev => {
      const updated = [...prev];
      const answer = { ...updated[questionIdx], selected: new Set(updated[questionIdx].selected) };
      const isMulti = request.questions[questionIdx].multiSelect;

      if (isMulti) {
        answer.useOther = !answer.useOther;
      } else {
        answer.selected.clear();
        answer.useOther = true;
      }

      updated[questionIdx] = answer;
      return updated;
    });
  };

  const handleOtherText = (questionIdx: number, text: string) => {
    setAnswers(prev => {
      const updated = [...prev];
      updated[questionIdx] = { ...updated[questionIdx], otherText: text };
      return updated;
    });
  };

  const handleSubmit = () => {
    const formatted = formatAnswers(request.questions, answers);
    setResolvedText(formatted);
    setResolved(true);
    onAnswer(request.requestId, formatted);
  };

  const handleSkip = () => {
    setResolvedText('Skipped');
    setResolved(true);
    onAnswer(request.requestId, 'User declined to answer.');
  };

  const hasAnswer = answers.some(
    a => a.selected.size > 0 || (a.useOther && a.otherText.trim())
  );

  // Resolved compact state
  if (resolved) {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-border/50 bg-secondary/30 text-xs text-muted-foreground">
        <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <div>
          <span className="font-medium">Question answered</span>
          <span className="text-muted-foreground/60"> — {resolvedText.split('\n')[0]?.replace('Q: ', '').slice(0, 60)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden border-l-4 border-l-primary">
      {/* Header */}
      <div className="px-3 py-2 bg-card flex items-center gap-2">
        <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-medium text-card-foreground">Claude has a question</span>
        {request.backendName && (
          <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            {request.backendName}
          </span>
        )}
      </div>

      {/* Questions */}
      <div className="px-3 py-2 border-t border-border/50 space-y-3">
        {request.questions.map((q, qIdx) => (
          <div key={qIdx}>
            <div className="flex items-start gap-2 mb-2">
              <span className="inline-block px-1.5 py-0.5 bg-primary/20 text-primary text-[10px] rounded font-medium flex-shrink-0 mt-0.5">
                {q.header}
              </span>
              <span className="text-xs text-foreground">{q.question}</span>
            </div>

            <div className="space-y-1 ml-1">
              {q.options.map((opt) => {
                const isSelected = answers[qIdx]?.selected.has(opt.label);
                const isMulti = q.multiSelect;

                return (
                  <label
                    key={opt.label}
                    className={`flex items-start gap-2 p-2 rounded cursor-pointer transition-colors text-xs ${
                      isSelected
                        ? 'bg-primary/10 border border-primary/30'
                        : 'bg-muted/50 border border-transparent hover:bg-muted'
                    }`}
                  >
                    <input
                      type={isMulti ? 'checkbox' : 'radio'}
                      name={`inline-q-${request.requestId}-${qIdx}`}
                      checked={isSelected}
                      onChange={() => handleOptionToggle(qIdx, opt.label)}
                      className="mt-0.5 w-3.5 h-3.5 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground">{opt.label}</div>
                      {opt.description && (
                        <div className="text-muted-foreground mt-0.5">{opt.description}</div>
                      )}
                    </div>
                  </label>
                );
              })}

              {/* Other option */}
              <label
                className={`flex items-start gap-2 p-2 rounded cursor-pointer transition-colors text-xs ${
                  answers[qIdx]?.useOther
                    ? 'bg-primary/10 border border-primary/30'
                    : 'bg-muted/50 border border-transparent hover:bg-muted'
                }`}
              >
                <input
                  type={q.multiSelect ? 'checkbox' : 'radio'}
                  name={`inline-q-${request.requestId}-${qIdx}`}
                  checked={answers[qIdx]?.useOther || false}
                  onChange={() => handleOtherToggle(qIdx)}
                  className="mt-0.5 w-3.5 h-3.5 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground">Other</div>
                  {answers[qIdx]?.useOther && (
                    <input
                      type="text"
                      value={answers[qIdx]?.otherText || ''}
                      onChange={(e) => handleOtherText(qIdx, e.target.value)}
                      placeholder="Type your answer..."
                      className="mt-1 w-full px-2 py-1 text-xs bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                      autoFocus
                    />
                  )}
                </div>
              </label>
            </div>
          </div>
        ))}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1" />
          <button
            onClick={handleSkip}
            className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-secondary-foreground rounded text-xs font-medium transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasAnswer}
            className="px-3 py-1.5 bg-primary hover:bg-primary/80 active:bg-primary/70 text-primary-foreground rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}
