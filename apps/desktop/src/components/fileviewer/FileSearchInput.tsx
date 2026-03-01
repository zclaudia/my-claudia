import { useState, useRef, useEffect, useCallback } from 'react';
import * as api from '../../services/api';
import type { FileEntry } from '@my-claudia/shared';

interface FileSearchInputProps {
  projectRoot: string;
  onSelect: (relativePath: string) => void;
  onClose: () => void;
}

export function FileSearchInput({ projectRoot, onSelect, onClose }: FileSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch results on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api.listDirectory({
          projectRoot,
          query: query.trim(),
          maxResults: 20,
        });
        setResults(result.entries.filter(e => e.type === 'file'));
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, projectRoot]);

  const handleSelect = useCallback((entry: FileEntry) => {
    onSelect(entry.path);
  }, [onSelect]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  };

  return (
    <div className="border-b border-border flex-shrink-0">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search files by name..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        {loading && (
          <span className="text-xs text-muted-foreground">...</span>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="max-h-[200px] overflow-y-auto">
          {results.map((entry, idx) => (
            <button
              key={entry.path}
              onClick={() => handleSelect(entry)}
              className={`w-full text-left px-3 py-1.5 text-sm font-mono flex items-center gap-2 ${
                idx === selectedIndex
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-secondary'
              }`}
            >
              <span className="truncate">{entry.path}</span>
            </button>
          ))}
        </div>
      )}

      {query && !loading && results.length === 0 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No files found
        </div>
      )}
    </div>
  );
}
