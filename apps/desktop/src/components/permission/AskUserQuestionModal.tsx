import { useState, useEffect } from 'react';
import type { AskUserQuestionItem } from '@my-claudia/shared';

interface AskUserQuestionRequest {
  requestId: string;
  questions: AskUserQuestionItem[];
}

interface AskUserQuestionModalProps {
  request: AskUserQuestionRequest | null;
  onAnswer: (requestId: string, formattedAnswer: string) => void;
}

// Per-question answer state
interface QuestionAnswer {
  selected: Set<string>;  // selected option labels
  otherText: string;
  useOther: boolean;
}

function formatAnswers(questions: AskUserQuestionItem[], answers: QuestionAnswer[]): string {
  return questions.map((q, i) => {
    const answer = answers[i];
    const parts: string[] = [];

    // Collect selected options
    for (const label of answer.selected) {
      parts.push(label);
    }

    // Add "Other" text if provided
    if (answer.useOther && answer.otherText.trim()) {
      parts.push(answer.otherText.trim());
    }

    const answerText = parts.length > 0 ? parts.join(', ') : 'No answer';
    return `Q: ${q.question}\nA: ${answerText}`;
  }).join('\n\n');
}

export function AskUserQuestionModal({ request, onAnswer }: AskUserQuestionModalProps) {
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);

  // Reset answers when request changes
  useEffect(() => {
    if (request) {
      setAnswers(
        request.questions.map(() => ({
          selected: new Set<string>(),
          otherText: '',
          useOther: false,
        }))
      );
    }
  }, [request]);

  if (!request || answers.length === 0) return null;

  const handleOptionToggle = (questionIdx: number, label: string) => {
    setAnswers(prev => {
      const updated = [...prev];
      const answer = { ...updated[questionIdx], selected: new Set(updated[questionIdx].selected) };
      const isMulti = request.questions[questionIdx].multiSelect;

      if (isMulti) {
        // Toggle checkbox
        if (answer.selected.has(label)) {
          answer.selected.delete(label);
        } else {
          answer.selected.add(label);
        }
      } else {
        // Radio: clear and set
        answer.selected.clear();
        answer.selected.add(label);
        // Deselect "Other" when selecting a predefined option
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
        // Radio: clear selections when choosing "Other"
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
    onAnswer(request.requestId, formatted);
  };

  // Check if any answer is provided
  const hasAnswer = answers.some(
    a => a.selected.size > 0 || (a.useOther && a.otherText.trim())
  );

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50" />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] max-w-[calc(100vw-2rem)] max-h-[80vh] bg-card border border-border rounded-lg shadow-2xl z-50 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-card-foreground">Claude has a question</h2>
              <p className="text-sm text-muted-foreground">
                Please select your answer{request.questions.length > 1 ? 's' : ''} below
              </p>
            </div>
          </div>
        </div>

        {/* Questions */}
        <div className="flex-1 overflow-y-auto px-5 py-3 border-t border-border space-y-5">
          {request.questions.map((q, qIdx) => (
            <div key={qIdx}>
              {/* Header chip + question text */}
              <div className="flex items-start gap-2 mb-3">
                <span className="inline-block px-2 py-0.5 bg-primary/20 text-primary text-xs rounded font-medium flex-shrink-0 mt-0.5">
                  {q.header}
                </span>
                <span className="text-sm text-foreground">{q.question}</span>
              </div>

              {/* Options */}
              <div className="space-y-1.5 ml-1">
                {q.options.map((opt) => {
                  const isSelected = answers[qIdx]?.selected.has(opt.label);
                  const isMulti = q.multiSelect;

                  return (
                    <label
                      key={opt.label}
                      className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary/10 border border-primary/30'
                          : 'bg-muted/50 border border-transparent hover:bg-muted'
                      }`}
                    >
                      <input
                        type={isMulti ? 'checkbox' : 'radio'}
                        name={`question-${qIdx}`}
                        checked={isSelected}
                        onChange={() => handleOptionToggle(qIdx, opt.label)}
                        className="mt-0.5 w-4 h-4 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">{opt.label}</div>
                        {opt.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                        )}
                      </div>
                    </label>
                  );
                })}

                {/* Other option */}
                <label
                  className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                    answers[qIdx]?.useOther
                      ? 'bg-primary/10 border border-primary/30'
                      : 'bg-muted/50 border border-transparent hover:bg-muted'
                  }`}
                >
                  <input
                    type={q.multiSelect ? 'checkbox' : 'radio'}
                    name={`question-${qIdx}`}
                    checked={answers[qIdx]?.useOther || false}
                    onChange={() => handleOtherToggle(qIdx)}
                    className="mt-0.5 w-4 h-4 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">Other</div>
                    {answers[qIdx]?.useOther && (
                      <input
                        type="text"
                        value={answers[qIdx]?.otherText || ''}
                        onChange={(e) => handleOtherText(qIdx, e.target.value)}
                        placeholder="Type your answer..."
                        className="mt-1.5 w-full px-2.5 py-1.5 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary"
                        autoFocus
                      />
                    )}
                  </div>
                </label>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 bg-muted/30 border-t border-border flex gap-3 flex-shrink-0">
          <button
            onClick={() => onAnswer(request.requestId, 'User declined to answer.')}
            className="flex-1 px-4 py-3 bg-secondary hover:bg-secondary/80 active:bg-secondary/70 text-secondary-foreground rounded-lg font-medium transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasAnswer}
            className="flex-1 px-4 py-3 bg-primary hover:bg-primary/80 active:bg-primary/70 text-primary-foreground rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit
          </button>
        </div>
      </div>
    </>
  );
}
