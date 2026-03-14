import { useState, useCallback } from 'react';
import { Sparkles, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
import type { WorkflowDefinitionV2, WorkflowTrigger } from '@my-claudia/shared';
import { generateWorkflowFromNL, refineGeneratedWorkflow } from '../../services/api';

interface NLWorkflowGeneratorProps {
  projectId: string;
  providerId: string;
  onGenerated: (result: {
    definition: WorkflowDefinitionV2;
    name: string;
    description: string;
    triggers: WorkflowTrigger[];
  }) => void;
}

interface HistoryEntry {
  role: 'user' | 'system';
  content: string;
}

export function NLWorkflowGenerator({ projectId, providerId, onGenerated }: NLWorkflowGeneratorProps) {
  const [description, setDescription] = useState('');
  const [refineInput, setRefineInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError(null);
    setWarnings([]);

    try {
      const result = await generateWorkflowFromNL(projectId, description.trim(), providerId);
      setGenerationId(result.generationId);
      setHistory([
        { role: 'user', content: description.trim() },
        { role: 'system', content: `Generated "${result.name}" with ${result.definition.nodes.length} nodes` },
      ]);
      setWarnings(result.warnings ?? []);
      onGenerated({
        definition: result.definition,
        name: result.name,
        description: result.description,
        triggers: result.definition.triggers,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [description, projectId, providerId, loading, onGenerated]);

  const handleRefine = useCallback(async () => {
    if (!refineInput.trim() || !generationId || loading) return;
    setLoading(true);
    setError(null);
    setWarnings([]);

    try {
      const result = await refineGeneratedWorkflow(projectId, generationId, refineInput.trim());
      setGenerationId(result.generationId);
      setHistory(prev => [
        ...prev,
        { role: 'user', content: refineInput.trim() },
        { role: 'system', content: `Updated to ${result.definition.nodes.length} nodes` },
      ]);
      setRefineInput('');
      setWarnings(result.warnings ?? []);
      onGenerated({
        definition: result.definition,
        name: result.name,
        description: result.description,
        triggers: result.definition.triggers,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refineInput, generationId, projectId, loading, onGenerated]);

  const handleReset = useCallback(() => {
    setDescription('');
    setRefineInput('');
    setGenerationId(null);
    setHistory([]);
    setError(null);
    setWarnings([]);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>, action: () => void) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      action();
    }
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles size={12} />
        <span className="flex-1">Describe your workflow</span>
        {generationId && (
          <button
            onClick={handleReset}
            className="p-0.5 rounded hover:bg-secondary hover:text-foreground"
            title="Reset"
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {!generationId ? (
        // Initial generation mode
        <div className="flex flex-col gap-2">
          <textarea
            className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-background resize-none focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => handleKeyDown(e, handleGenerate)}
            placeholder={"e.g. Every day at 9 AM, check git for uncommitted changes, auto-commit and run tests. If tests fail, notify me."}
            rows={5}
            disabled={loading}
          />
          <button
            onClick={handleGenerate}
            disabled={!description.trim() || loading || !providerId}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {loading ? 'Generating...' : 'Generate'}
          </button>
          {!providerId && (
            <p className="text-[10px] text-destructive">No provider configured.</p>
          )}
          <p className="text-[10px] text-muted-foreground/60">Cmd+Enter to submit</p>
        </div>
      ) : (
        // Refine mode
        <div className="flex flex-col gap-2">
          {/* History */}
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {history.map((entry, i) => (
              <div
                key={i}
                className={`text-[10px] px-1.5 py-1 rounded ${
                  entry.role === 'user'
                    ? 'bg-primary/10 text-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <span className="font-medium">{entry.role === 'user' ? 'You: ' : 'AI: '}</span>
                <span className="break-words">{entry.content}</span>
              </div>
            ))}
          </div>

          {/* Refine input */}
          <textarea
            className="w-full px-2 py-1.5 text-xs rounded-md border border-border bg-background resize-none focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
            value={refineInput}
            onChange={e => setRefineInput(e.target.value)}
            onKeyDown={e => handleKeyDown(e, handleRefine)}
            placeholder="Describe changes..."
            rows={3}
            disabled={loading}
          />
          <button
            onClick={handleRefine}
            disabled={!refineInput.trim() || loading}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {loading ? 'Refining...' : 'Refine'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-1.5 text-[10px] text-destructive bg-destructive/10 rounded-md px-2 py-1.5">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 rounded-md px-2 py-1">
              <AlertTriangle size={10} className="shrink-0 mt-0.5" />
              <span className="break-words">{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
