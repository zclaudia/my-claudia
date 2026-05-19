import { useState } from 'react';
import { X } from 'lucide-react';

const BUILT_IN_TAGS = [
  'bug',
  'enhancement',
  'task',
  'refactor',
  'docs',
  'test',
  'ui',
  'backend',
  'follow-up',
  'blocked',
];

interface IssueTagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
}

function normalizeIssueTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

export function IssueTagPicker({ value, onChange }: IssueTagPickerProps) {
  const [customTag, setCustomTag] = useState('');

  const hasTag = (tag: string) => value.some((item) => normalizeIssueTag(item) === normalizeIssueTag(tag));

  const addTag = (tag: string) => {
    const normalized = normalizeIssueTag(tag);
    if (!normalized || hasTag(normalized)) return;
    onChange([...value, normalized]);
    setCustomTag('');
  };

  const removeTag = (tag: string) => {
    const normalized = normalizeIssueTag(tag);
    onChange(value.filter((item) => normalizeIssueTag(item) !== normalized));
  };

  const toggleTag = (tag: string) => {
    if (hasTag(tag)) removeTag(tag);
    else addTag(tag);
  };

  const handleCustomKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTag(customTag);
  };

  return (
    <div className="mt-1 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {BUILT_IN_TAGS.map((tag) => {
          const selected = hasTag(tag);
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              aria-pressed={selected}
              aria-label={`Toggle ${tag} tag`}
              className={selected
                ? 'text-[11px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-500 dark:text-purple-300 border border-purple-500/30'
                : 'text-[11px] px-2 py-0.5 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground hover:border-primary/40'}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-secondary text-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${tag} tag`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={customTag}
          onChange={(event) => setCustomTag(event.target.value)}
          onKeyDown={handleCustomKeyDown}
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Add custom tag..."
        />
        <button
          type="button"
          onClick={() => addTag(customTag)}
          className="px-3 py-1.5 text-xs rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Add custom tag"
        >
          Add
        </button>
      </div>
    </div>
  );
}
