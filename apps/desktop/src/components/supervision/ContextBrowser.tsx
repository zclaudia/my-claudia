import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import * as api from '../../services/api';

interface ContextDocument {
  id: string;
  category: string;
  source: string;
  version: number;
  content: string;
}

interface ContextBrowserProps {
  projectId: string;
}

export function ContextBrowser({ projectId }: ContextBrowserProps) {
  const [docs, setDocs] = useState<ContextDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSupervisionContext(projectId);
      setDocs(result as ContextDocument[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load context');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleReload = async () => {
    setLoading(true);
    try {
      await api.reloadSupervisionContext(projectId);
      await fetchDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload');
    } finally {
      setLoading(false);
    }
  };

  const selected = docs.find((d) => d.id === selectedDoc);

  // Group by category
  const categories = docs.reduce<Record<string, ContextDocument[]>>((acc, doc) => {
    const cat = doc.category || 'other';
    (acc[cat] ??= []).push(doc);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Context</h3>
        <button
          onClick={handleReload}
          disabled={loading}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Reload from disk"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="px-3 py-1 text-xs text-destructive">{error}</div>
      )}

      <div className="flex-1 overflow-y-auto">
        {docs.length === 0 && !loading ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            No .supervision/ documents found
          </div>
        ) : (
          <div className="px-1 py-1">
            {Object.entries(categories).map(([cat, catDocs]) => (
              <CategorySection
                key={cat}
                category={cat}
                docs={catDocs}
                selectedDoc={selectedDoc}
                onSelect={setSelectedDoc}
              />
            ))}
          </div>
        )}
      </div>

      {/* Document preview */}
      {selected && (
        <div className="border-t border-border flex-shrink-0 max-h-48 overflow-y-auto">
          <div className="px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">{selected.id}</span>
              <span className="text-[10px] text-muted-foreground">v{selected.version}</span>
            </div>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto">
              {selected.content.slice(0, 2000)}
              {selected.content.length > 2000 && '\n\n[... truncated ...]'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function CategorySection({
  category,
  docs,
  selectedDoc,
  onSelect,
}: {
  category: string;
  docs: ContextDocument[];
  selectedDoc: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 w-full px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {category}
        <span className="text-muted-foreground/50 ml-1">({docs.length})</span>
      </button>
      {expanded && (
        <div className="ml-3">
          {docs.map((doc) => (
            <button
              key={doc.id}
              onClick={() => onSelect(selectedDoc === doc.id ? null : doc.id)}
              className={`flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded hover:bg-secondary ${
                selectedDoc === doc.id ? 'bg-secondary text-foreground' : 'text-muted-foreground'
              }`}
            >
              <FileText size={10} />
              <span className="truncate">{doc.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
