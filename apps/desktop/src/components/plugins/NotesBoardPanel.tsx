import { useEffect, useState, useCallback } from 'react';
import { fetchLocalApi } from '../../services/api';
import { StickyNote, RefreshCw, Search, Tag } from 'lucide-react';

interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
}

function NoteCard({ note }: { note: Note }) {
  const date = new Date(note.createdAt);
  const colors = [
    'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 dark:border-yellow-800',
    'border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800',
    'border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800',
    'border-purple-300 bg-purple-50 dark:bg-purple-950/30 dark:border-purple-800',
    'border-pink-300 bg-pink-50 dark:bg-pink-950/30 dark:border-pink-800',
  ];
  // Deterministic color based on note ID
  const colorClass = colors[parseInt(note.id.slice(-1), 16) % colors.length];

  return (
    <div className={`rounded-lg border-2 p-3 flex flex-col gap-2 ${colorClass}`}>
      <p className="text-sm font-medium leading-snug line-clamp-2">{note.content}</p>
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {note.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-background/60 text-muted-foreground">
              <Tag className="w-2.5 h-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-auto">
        {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  );
}

export function NotesBoardPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    try {
      const result = await fetchLocalApi<Record<string, unknown>>('/api/system/plugin-storage/note-keeper');
      if (result.success && result.data) {
        const rawNotes = result.data['notes'];
        setNotes(Array.isArray(rawNotes) ? rawNotes as Note[] : []);
        setError(null);
      }
    } catch {
      setError('Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const filtered = filter.trim()
    ? notes.filter(n =>
        n.content.toLowerCase().includes(filter.toLowerCase()) ||
        n.tags.some(t => t.toLowerCase().includes(filter.toLowerCase()))
      )
    : notes;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading notes...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        <StickyNote className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Notes Board</span>
        <span className="text-xs text-muted-foreground">({notes.length} notes)</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              className="text-xs pl-6 pr-2 py-1 rounded border bg-background w-36 focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search notes..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>
          <button
            onClick={fetchNotes}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Notes grid */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="text-sm text-destructive text-center py-8">{error}</div>
        )}
        {!error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <StickyNote className="w-8 h-8 opacity-30" />
            <p className="text-sm">
              {filter ? 'No notes match your search' : 'No notes yet — use /note to add one'}
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map(note => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      </div>
    </div>
  );
}
