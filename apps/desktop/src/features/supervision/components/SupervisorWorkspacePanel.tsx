import { useEffect, useMemo, useState } from 'react';
import type { AcceptanceDecision, ExecutionGateDecision, ProjectAgent, ProjectChange, ProviderConfig } from '@my-claudia/shared';
import * as api from '../../../services/api';
import { useSupervisionStore } from '../store';
import { TaskBoard } from './TaskBoard';

interface SupervisorWorkspacePanelProps {
  projectId: string;
  agent: ProjectAgent | null;
}

interface ContextDocumentPreview {
  id: string;
  version: number;
  content: string;
}

type PreviewDocTarget = 'design' | 'execution' | 'tasks';
type EditableDocType = 'project' | 'architecture' | 'design' | 'execution' | 'tasks';
type BaselineSetupMode = 'template' | 'scan' | 'ai_scan';
type BaselineSetupLanguage = 'zh-CN' | 'en';

const changeStatusLabel: Record<string, string> = {
  draft: 'Draft',
  designing: 'Designing',
  awaiting_design_review: 'Awaiting Design Review',
  planning: 'Planning',
  awaiting_execution_review: 'Awaiting Execution Review',
  executing: 'Executing',
  paused: 'Paused',
  accepting: 'Accepting',
  syncing: 'Syncing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function SupervisorWorkspacePanel({ projectId, agent }: SupervisorWorkspacePanelProps) {
  const activeChange = useSupervisionStore((s) => s.activeChanges[projectId] ?? null);
  const executionPlan = useSupervisionStore((s) => activeChange ? s.executionPlans[activeChange.id] : undefined);
  const tasks = useSupervisionStore((s) => s.tasks[projectId] ?? []);
  const setActiveChange = useSupervisionStore((s) => s.setActiveChange);
  const setExecutionPlan = useSupervisionStore((s) => s.setExecutionPlan);
  const setTasks = useSupervisionStore((s) => s.setTasks);
  const [loading, setLoading] = useState(false);
  const [showCreateChange, setShowCreateChange] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<ContextDocumentPreview[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [changeHistory, setChangeHistory] = useState<ProjectChange[]>([]);
  const [allChanges, setAllChanges] = useState<ProjectChange[]>([]);
  const [previewChangeId, setPreviewChangeId] = useState<string | null>(null);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [changesFilter, setChangesFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [draftDocContent, setDraftDocContent] = useState('');
  const [baselineReady, setBaselineReady] = useState(false);
  const [baselineNotice, setBaselineNotice] = useState<string | null>(null);
  const [showBaselineSetup, setShowBaselineSetup] = useState(false);
  const [baselineMode, setBaselineMode] = useState<BaselineSetupMode>('scan');
  const [baselineLanguage, setBaselineLanguage] = useState<BaselineSetupLanguage>('zh-CN');
  const [baselineProviderId, setBaselineProviderId] = useState<string>('');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const [change, providerList] = await Promise.all([
          api.getActiveProjectChange(projectId),
          api.getProviders().catch(() => [] as ProviderConfig[]),
        ]);
        if (cancelled) return;
        setProviders(providerList);
        const defaultProvider = providerList.find((provider) => provider.isDefault) ?? providerList[0] ?? null;
        setBaselineProviderId((prev) => prev || defaultProvider?.id || '');
        setActiveChange(projectId, change);
        setPreviewChangeId(change?.id ?? null);
        const changes = await api.getProjectChanges(projectId);
        if (cancelled) return;
        setAllChanges(changes);
        setChangeHistory(changes.filter((item) => !item.active));
        const contextDocs = await api.getSupervisionContext(projectId);
        if (cancelled) return;
        setBaselineReady(hasBaselineDocs(contextDocs));
        if (change) {
          const [plan, filteredTasks] = await Promise.all([
            api.getChangeExecutionPlan(change.id),
            api.getSupervisionTasks(projectId, change.id),
          ]);
          if (cancelled) return;
          setExecutionPlan(change.id, plan);
          setTasks(projectId, filteredTasks);
          const nextDocs = extractWorkspaceDocs(change.id, contextDocs);
          setDocs(nextDocs);
          setSelectedDocId((prev) => prev && nextDocs.some((doc) => doc.id === prev) ? prev : nextDocs[0]?.id ?? null);
        } else {
          const nextDocs = extractWorkspaceDocs(undefined, contextDocs);
          setDocs(nextDocs);
          setSelectedDocId(nextDocs[0]?.id ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load supervisor workspace');
        }
      }
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [projectId, setActiveChange, setExecutionPlan, setTasks]);

  const changeTasks = useMemo(
    () => activeChange ? tasks.filter((task) => task.changeId === activeChange.id) : [],
    [activeChange, tasks],
  );

  const refreshActiveChange = async (change: ProjectChange) => {
    setActiveChange(projectId, change);
    setPreviewChangeId(change.id);
    const [plan, filteredTasks, contextDocs, changes] = await Promise.all([
      api.getChangeExecutionPlan(change.id),
      api.getSupervisionTasks(projectId, change.id),
      api.getSupervisionContext(projectId),
      api.getProjectChanges(projectId),
    ]);
    setExecutionPlan(change.id, plan);
    setTasks(projectId, filteredTasks);
    setAllChanges(changes);
    setChangeHistory(changes.filter((item) => !item.active));
    const nextDocs = extractWorkspaceDocs(change.id, contextDocs);
    setDocs(nextDocs);
    setSelectedDocId((prev) => prev && nextDocs.some((doc) => doc.id === prev) ? prev : nextDocs[0]?.id ?? null);
  };

  const handleCreateChange = async () => {
    if (!newTitle.trim() || !newSummary.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const change = await api.createProjectChange(projectId, {
        title: newTitle.trim(),
        summary: newSummary.trim(),
      });
      await refreshActiveChange(change);
      setShowCreateChange(false);
      setNewTitle('');
      setNewSummary('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create change');
    } finally {
      setLoading(false);
    }
  };

  const handleInitBaseline = async () => {
    setLoading(true);
    setError(null);
    setBaselineNotice(null);
    try {
      const result = await api.initSupervisorBaseline(projectId, {
        mode: baselineMode,
        providerId: baselineMode === 'ai_scan' ? baselineProviderId || undefined : undefined,
        language: baselineLanguage,
        force: baselineReady,
      });
      const contextDocs = await api.getSupervisionContext(projectId);
      const ready = hasBaselineDocs(contextDocs);
      setBaselineReady(ready);
      setBaselineNotice(
        ready
          ? (result.usedAi
            ? `Baseline regenerated with AI in ${baselineLanguage === 'zh-CN' ? '中文' : 'English'} and saved to \`.supervision/baseline/\`.`
            : baselineMode === 'scan'
              ? `Baseline ${baselineReady ? 'regenerated' : 'generated'} from project scan and saved to \`.supervision/baseline/\`.`
              : `Baseline files are ready in \`.supervision/baseline/\`.`)
          : 'Baseline initialization finished, but no baseline docs were detected yet.',
      );
      const nextDocs = extractWorkspaceDocs(activeChange?.id, contextDocs);
      setDocs(nextDocs);
      setSelectedDocId((prev) => prev && nextDocs.some((doc) => doc.id === prev) ? prev : nextDocs[0]?.id ?? null);
      setShowBaselineSetup(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize baseline');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestDesign = async () => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.requestDesignGate(activeChange.id, actionNotes.trim() || undefined);
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request design review');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveDesign = async (decision: 'approve_design' | 'revise_design' | 'revise_change') => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.resolveDesignGate(activeChange.id, decision, actionNotes.trim() || undefined);
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve design gate');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestExecution = async () => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.requestExecutionGate(activeChange.id, actionNotes.trim() || undefined);
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request execution review');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveExecution = async (decision: ExecutionGateDecision) => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.resolveExecutionGate(activeChange.id, decision, actionNotes.trim() || undefined);
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve execution gate');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestSync = async () => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.requestChangeSync(activeChange.id, actionNotes.trim() || undefined);
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request sync');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAcceptance = async () => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.requestAcceptance(activeChange.id, actionNotes.trim() || undefined);
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request acceptance');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveAcceptance = async (decision: AcceptanceDecision) => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.resolveAcceptance(activeChange.id, decision, actionNotes.trim() || undefined);
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve acceptance');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteChange = async () => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.completeProjectChange(activeChange.id, actionNotes.trim() || undefined);
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete change');
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewChange = async (change: ProjectChange, preferredDoc?: PreviewDocTarget) => {
    setLoading(true);
    setError(null);
    try {
      const contextDocs = await api.getSupervisionContext(projectId);
      const nextDocs = extractWorkspaceDocs(change.id, contextDocs);
      setPreviewChangeId(change.id);
      setDocs(nextDocs);
      setEditingDocId(null);
      setDraftDocContent('');
      const preferredDocId = preferredDoc
        ? nextDocs.find((doc) => doc.id.endsWith(`/${preferredDoc}.md`))?.id ?? null
        : null;
      setSelectedDocId(
        preferredDocId
          ?? ((prev) => prev && nextDocs.some((doc) => doc.id === prev) ? prev : nextDocs[0]?.id ?? null),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load change documents');
    } finally {
      setLoading(false);
    }
  };

  const selectedDoc = docs.find((doc) => doc.id === selectedDocId) ?? null;
  const selectedDocType = selectedDoc ? getEditableDocType(selectedDoc.id) : null;
  const canRequestDesign = activeChange?.status === 'draft' || activeChange?.status === 'designing';
  const canApproveDesign = activeChange?.status === 'awaiting_design_review';
  const canRequestExecution = activeChange?.status === 'planning';
  const canApproveExecution = activeChange?.status === 'awaiting_execution_review';
  const canRequestAcceptance = activeChange?.status === 'executing';
  const canApproveAcceptance = activeChange?.status === 'accepting';
  const canRequestSync = false;
  const canCompleteChange = activeChange?.status === 'syncing';
  const showActionNotes = canRequestDesign
    || canApproveDesign
    || canRequestExecution
    || canApproveExecution
    || canRequestAcceptance
    || canApproveAcceptance
    || canRequestSync
    || canCompleteChange;
  const recentHistory = useMemo(
    () => [...changeHistory].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)).slice(0, 5),
    [changeHistory],
  );
  const filteredChanges = useMemo(() => {
    const sorted = [...allChanges].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    if (changesFilter === 'active') return sorted.filter((change) => change.active);
    if (changesFilter === 'completed') return sorted.filter((change) => change.status === 'completed');
    if (changesFilter === 'cancelled') return sorted.filter((change) => change.status === 'cancelled');
    return sorted;
  }, [allChanges, changesFilter]);
  const previewChange = useMemo(
    () => (activeChange?.id === previewChangeId
      ? activeChange
      : recentHistory.find((change) => change.id === previewChangeId) ?? null),
    [activeChange, previewChangeId, recentHistory],
  );
  const isBaselineDoc = Boolean(selectedDoc?.id.startsWith('baseline/'));
  const canEditSelectedDoc = Boolean(
    selectedDocType
      && (
        isBaselineDoc
        || (
          selectedDoc
          && previewChange
          && activeChange
          && previewChange.id === activeChange.id
          && ['design', 'execution'].includes(selectedDocType)
        )
      ),
  );
  const previewAcceptanceDoc = previewChange
    ? docs.find((doc) => doc.id === `changes/${previewChange.id}/acceptance.md`) ?? null
    : null;
  const previewSyncDoc = previewChange
    ? docs.find((doc) => doc.id === `changes/${previewChange.id}/sync-log.md`) ?? null
    : null;
  const nextAction = activeChange ? getNextAction(activeChange.status) : null;
  const aiCapableProviders = useMemo(
    () => providers.filter((provider) => ['claude', 'codex', 'cursor', 'kimi', 'opencode'].includes(provider.type)),
    [providers],
  );

  const handleStartEditing = () => {
    if (!selectedDoc) return;
    setEditingDocId(selectedDoc.id);
    setDraftDocContent(selectedDoc.content);
  };

  const handleCancelEditing = () => {
    setEditingDocId(null);
    setDraftDocContent('');
  };

  const handleSaveDocument = async () => {
    if (!selectedDoc || !selectedDocType) return;
    setLoading(true);
    setError(null);
    try {
      if (selectedDoc.id.startsWith('baseline/')) {
        await api.updateBaselineDocument(projectId, selectedDocType as 'project' | 'architecture', draftDocContent);
        const contextDocs = await api.getSupervisionContext(projectId);
        setBaselineReady(hasBaselineDocs(contextDocs));
        const nextDocs = extractWorkspaceDocs(activeChange?.id, contextDocs);
        setDocs(nextDocs);
        setSelectedDocId(selectedDoc.id);
      } else {
        if (!activeChange) return;
        const updated = await api.updateChangeDocument(activeChange.id, selectedDocType as 'design' | 'execution' | 'tasks', draftDocContent);
        await refreshActiveChange(updated);
      }
      setEditingDocId(null);
      setDraftDocContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save change document');
    } finally {
      setLoading(false);
    }
  };

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <p className="text-sm">No supervisor agent configured.</p>
          <p className="text-xs mt-1">Enable supervisor first in project settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="px-4 py-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Supervisor Workspace</h2>
            <p className="text-xs text-muted-foreground">Spec-driven execution for the active change.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBaselineSetup((value) => !value)}
              disabled={loading}
              className="px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
            >
              {baselineReady ? 'Regenerate Baseline' : 'Generate Baseline'}
            </button>
            <button
              onClick={() => setShowCreateChange((value) => !value)}
              disabled={loading || Boolean(activeChange)}
              className="px-2.5 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Start Change
            </button>
          </div>
        </div>

        {showBaselineSetup && (
          <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3">
            <div>
              <div className="text-xs font-medium text-foreground">Baseline Generation</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Choose how `baseline/project.md` and `baseline/architecture.md` should be created.
              </div>
            </div>

            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Mode</span>
                <select
                  aria-label="Mode"
                  value={baselineMode}
                  onChange={(event) => setBaselineMode(event.target.value as BaselineSetupMode)}
                  className="rounded border border-border bg-background px-3 py-2 text-xs"
                >
                  <option value="template">Template Only</option>
                  <option value="scan">Project Scan</option>
                  <option value="ai_scan">AI Scan</option>
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Language</span>
                <select
                  aria-label="Language"
                  value={baselineLanguage}
                  onChange={(event) => setBaselineLanguage(event.target.value as BaselineSetupLanguage)}
                  className="rounded border border-border bg-background px-3 py-2 text-xs"
                >
                  <option value="zh-CN">中文</option>
                  <option value="en">English</option>
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">AI Provider</span>
                <select
                  aria-label="AI Provider"
                  value={baselineProviderId}
                  onChange={(event) => setBaselineProviderId(event.target.value)}
                  disabled={baselineMode !== 'ai_scan'}
                  className="rounded border border-border bg-background px-3 py-2 text-xs disabled:opacity-50"
                >
                  {aiCapableProviders.length === 0 ? (
                    <option value="">No supported provider</option>
                  ) : (
                    aiCapableProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} ({provider.type})
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            <div className="rounded border border-border bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
              {baselineMode === 'template'
                ? 'Create baseline files from the default template only.'
                : baselineMode === 'scan'
                  ? 'Scan the project structure and generate a first-pass baseline without using AI.'
                  : 'Use the selected AI provider to turn project scan results into a richer baseline draft.'}
              {baselineReady ? ' Existing baseline files will be regenerated.' : ''}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBaselineSetup(false)}
                disabled={loading}
                className="px-3 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInitBaseline}
                disabled={loading || (baselineMode === 'ai_scan' && !baselineProviderId && aiCapableProviders.length > 0)}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {baselineReady ? 'Regenerate Baseline' : 'Generate Baseline'}
              </button>
            </div>
          </div>
        )}

        {showCreateChange && !activeChange && (
          <div className="grid gap-2 rounded-lg border border-border bg-secondary/30 p-3">
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="Change title"
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
            <textarea
              value={newSummary}
              onChange={(event) => setNewSummary(event.target.value)}
              placeholder="What will this change accomplish?"
              rows={3}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm resize-none"
            />
            <div className="flex justify-end">
              <button
                onClick={handleCreateChange}
                disabled={loading || !newTitle.trim() || !newSummary.trim()}
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Create Change
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {baselineNotice && !error && (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
            {baselineNotice}
          </div>
        )}

        {activeChange && (
          <div className="rounded-lg border border-border bg-card px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Active Change</div>
                <div className="mt-1 text-sm font-semibold">{activeChange.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{activeChange.summary}</div>
              </div>
              <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {changeStatusLabel[activeChange.status] ?? activeChange.status}
              </span>
            </div>

            {executionPlan && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>Strategy: <span className="text-foreground">{executionPlan.automation.strategy}</span></div>
                <div>Tasks: <span className="text-foreground">{changeTasks.length}</span></div>
              </div>
            )}

            {nextAction && (
              <div className="mt-3 rounded border border-border bg-secondary/20 px-3 py-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Next Action
                </div>
                <div className="mt-1 text-xs text-foreground">{nextAction.title}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{nextAction.description}</div>
              </div>
            )}

            {showActionNotes && (
              <div className="mt-3 space-y-1">
                <label htmlFor="supervisor-action-notes" className="text-[11px] font-medium text-muted-foreground">
                  Review / Sync Notes
                </label>
                <textarea
                  id="supervisor-action-notes"
                  value={actionNotes}
                  onChange={(event) => setActionNotes(event.target.value)}
                  placeholder="Optional notes for the next gate or sync action..."
                  rows={2}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-xs resize-none"
                />
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={handleRequestDesign}
                disabled={loading || !canRequestDesign}
                className="px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
              >
                Request Design Review
              </button>
              <button
                onClick={() => handleResolveDesign('approve_design')}
                disabled={loading || !canApproveDesign}
                className="px-2.5 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                Approve Design
              </button>
              <button
                onClick={handleRequestExecution}
                disabled={loading || !canRequestExecution}
                className="px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
              >
                Request Execution Review
              </button>
              <button
                onClick={() => handleResolveExecution('approve_execution')}
                disabled={loading || !canApproveExecution}
                className="px-2.5 py-1.5 text-xs rounded bg-blue-500/15 text-blue-600 hover:bg-blue-500/25 disabled:opacity-50"
              >
                Start Execution
              </button>
              <button
                onClick={handleRequestAcceptance}
                disabled={loading || !canRequestAcceptance}
                className="px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
              >
                Request Acceptance
              </button>
              <button
                onClick={() => handleResolveAcceptance('approve_acceptance')}
                disabled={loading || !canApproveAcceptance}
                className="px-2.5 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                Approve Acceptance
              </button>
              <button
                onClick={() => handleResolveAcceptance('revise_execution')}
                disabled={loading || !canApproveAcceptance}
                className="px-2.5 py-1.5 text-xs rounded bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 disabled:opacity-50"
              >
                Reopen Execution
              </button>
              <button
                onClick={handleRequestSync}
                disabled={loading || !canRequestSync}
                className="hidden px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
              >
                Request Sync
              </button>
              <button
                onClick={handleCompleteChange}
                disabled={loading || !canCompleteChange}
                className="px-2.5 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                Complete Change
              </button>
            </div>
          </div>
        )}

        {recentHistory.length > 0 && (
          <div className="rounded-lg border border-border bg-card px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent Changes</div>
                <div className="mt-1 text-xs text-muted-foreground">Read-only history for this project.</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  {recentHistory.length}
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllChanges((value) => !value)}
                  className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {showAllChanges ? 'Hide All' : 'View All'}
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {recentHistory.map((change) => (
                <div
                  key={change.id}
                  className={`rounded border px-3 py-2 transition-colors ${
                    previewChangeId === change.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-secondary/20'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handlePreviewChange(change)}
                    disabled={loading}
                    aria-label={`Preview ${change.title}`}
                    className="w-full text-left disabled:opacity-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">{change.title}</div>
                        <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{change.summary}</div>
                      </div>
                      <span className="rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        {changeStatusLabel[change.status] ?? change.status}
                      </span>
                    </div>
                  </button>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handlePreviewChange(change, 'design')}
                      disabled={loading}
                      aria-label={`Open ${change.title} design`}
                      className="rounded bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Design
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePreviewChange(change, 'execution')}
                      disabled={loading}
                      aria-label={`Open ${change.title} execution`}
                      className="rounded bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Execution
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePreviewChange(change, 'tasks')}
                      disabled={loading}
                      aria-label={`Open ${change.title} tasks`}
                      className="rounded bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Tasks
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showAllChanges && allChanges.length > 0 && (
          <div className="rounded-lg border border-border bg-card px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">All Changes</div>
                <div className="mt-1 text-xs text-muted-foreground">Project-level change list with lightweight filters.</div>
              </div>
              <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {filteredChanges.length}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {(['all', 'active', 'completed', 'cancelled'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setChangesFilter(filter)}
                  className={`rounded px-2 py-1 text-[11px] transition-colors ${
                    changesFilter === filter
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {filter === 'all' ? 'All' : filter[0]!.toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>

            <div className="mt-3 space-y-2">
              {filteredChanges.map((change) => (
                <div
                  key={change.id}
                  className={`rounded border px-3 py-2 transition-colors ${
                    previewChangeId === change.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border bg-secondary/20'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handlePreviewChange(change)}
                    aria-label={`Preview ${change.title}`}
                    disabled={loading}
                    className="w-full text-left disabled:opacity-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">{change.title}</div>
                        <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{change.summary}</div>
                      </div>
                      <span className="rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        {changeStatusLabel[change.status] ?? change.status}
                      </span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeChange || docs.length > 0 ? (
          <div className="grid h-full grid-cols-[1.2fr_1fr]">
            <div className="min-w-0 overflow-hidden border-r border-border">
              {activeChange ? (
                <TaskBoard
                  projectId={projectId}
                  changeId={activeChange.id}
                  title={activeChange.title}
                  tasks={changeTasks}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground">
                  <div>
                    <p className="text-sm">Project context is available.</p>
                    <p className="mt-1 text-xs">Review or edit baseline docs, then start a change when you are ready.</p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">Workspace Docs</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {selectedDoc?.id.startsWith('baseline/')
                      ? <>Viewing `.supervision/baseline/`</>
                      : previewChange
                        ? <>Viewing `.supervision/changes/{previewChange.id}`</>
                        : activeChange
                          ? <>Live view from `.supervision/changes/{activeChange.id}`</>
                          : <>Viewing project baseline and workspace docs</>}
                  </p>
                </div>
                {previewChange && activeChange && previewChange.id !== activeChange.id && (
                  <button
                    type="button"
                    onClick={() => void handlePreviewChange(activeChange)}
                    disabled={loading}
                    className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    Back To Active
                  </button>
                )}
                {((selectedDoc?.id.startsWith('baseline/')) || (previewChange && previewChange.id === activeChange?.id)) && selectedDoc && (
                  <div className="flex items-center gap-2">
                    {canEditSelectedDoc && editingDocId !== selectedDoc.id && (
                      <button
                        type="button"
                        onClick={handleStartEditing}
                        disabled={loading}
                        className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        Edit
                      </button>
                    )}
                    {editingDocId === selectedDoc.id && (
                      <>
                        <button
                          type="button"
                          onClick={handleCancelEditing}
                          disabled={loading}
                          className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveDocument}
                          disabled={loading}
                          className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                          Save
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-1 border-b border-border px-3 py-2">
                {docs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`rounded px-2 py-1 text-xs transition-colors ${
                      selectedDocId === doc.id
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {formatDocLabel(doc.id)}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-auto px-3 py-3">
                {selectedDoc ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{selectedDoc.id}</span>
                      <span>v{selectedDoc.version}</span>
                    </div>
                    {previewChange && (
                      <div className="rounded-lg border border-border bg-secondary/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">{previewChange.title}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{previewChange.summary}</div>
                          </div>
                          <span className="rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                            {changeStatusLabel[previewChange.status] ?? previewChange.status}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                          <div>
                            Change ID: <span className="text-foreground">{previewChange.id}</span>
                          </div>
                          <div>
                            Updated: <span className="text-foreground">{formatTimestamp(previewChange.updatedAt ?? previewChange.createdAt)}</span>
                          </div>
                        </div>
                        {(previewAcceptanceDoc || previewSyncDoc) && (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {previewAcceptanceDoc && (
                              <div className="rounded border border-border bg-background px-2.5 py-2">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Acceptance
                                </div>
                                <div className="mt-1 text-[11px] text-foreground">
                                  {extractDocSummary(previewAcceptanceDoc.content, 'No acceptance summary yet.')}
                                </div>
                              </div>
                            )}
                            {previewSyncDoc && (
                              <div className="rounded border border-border bg-background px-2.5 py-2">
                                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Sync
                                </div>
                                <div className="mt-1 text-[11px] text-foreground">
                                  {extractDocSummary(
                                    previewSyncDoc.content,
                                    previewChange.status === 'completed'
                                      ? 'Change has been completed and synced.'
                                      : 'Waiting for sync details.',
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {editingDocId === selectedDoc.id ? (
                      <textarea
                        value={draftDocContent}
                        onChange={(event) => setDraftDocContent(event.target.value)}
                        rows={20}
                        className="w-full rounded-lg border border-border bg-background p-3 text-xs leading-5 text-foreground resize-y"
                      />
                    ) : (
                      <pre className="whitespace-pre-wrap rounded-lg bg-secondary/40 p-3 text-xs leading-5 text-foreground/90">
                        {selectedDoc.content}
                      </pre>
                    )}
                  </div>
                ) : (
                <div className="flex h-full items-center justify-center text-center text-muted-foreground">
                  <div>
                    <p className="text-sm">No workspace documents loaded.</p>
                    <p className="mt-1 text-xs">Set up context or select a change to view baseline, design, execution, and task docs.</p>
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-muted-foreground">
            <div>
              <p className="text-sm">No active change yet.</p>
              <p className="mt-1 text-xs">Set up project context, then create a change to start spec-driven execution.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function extractWorkspaceDocs(changeId: string | undefined, docs: Array<{ id: string; version?: number; content?: string }>): ContextDocumentPreview[] {
  const targetIds = [
    'baseline/project.md',
    'baseline/architecture.md',
    ...(changeId
      ? [
          `changes/${changeId}/design.md`,
          `changes/${changeId}/execution.md`,
          `changes/${changeId}/tasks.md`,
          `changes/${changeId}/acceptance.md`,
          `changes/${changeId}/sync-log.md`,
        ]
      : []),
  ];
  return targetIds
    .map((id) => docs.find((doc) => doc.id === id))
    .filter((doc): doc is { id: string; version?: number; content?: string } => Boolean(doc))
    .map((doc) => ({
      id: doc.id,
      version: typeof doc.version === 'number' ? doc.version : 1,
      content: doc.content ?? '',
    }));
}

function formatDocLabel(docId: string): string {
  const fileName = docId.split('/').pop()?.replace('.md', '') ?? docId;
  if (docId === 'baseline/project.md') return 'Project';
  if (docId === 'baseline/architecture.md') return 'Architecture';
  if (fileName === 'design') return 'Design';
  if (fileName === 'execution') return 'Execution';
  if (fileName === 'tasks') return 'Tasks';
  if (fileName === 'acceptance') return 'Acceptance';
  if (fileName === 'sync-log') return 'Sync Log';
  return fileName;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toISOString().slice(0, 10);
}

function getEditableDocType(docId: string): EditableDocType | null {
  const fileName = docId.split('/').pop()?.replace('.md', '') ?? '';
  if (fileName === 'project' || fileName === 'architecture' || fileName === 'design' || fileName === 'execution' || fileName === 'tasks') {
    return fileName;
  }
  return null;
}

function extractDocSummary(content: string, fallback: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return lines[0] ?? fallback;
}

function hasBaselineDocs(docs: Array<{ id: string }>): boolean {
  return docs.some((doc) => doc.id === 'baseline/project.md' || doc.id === 'baseline/architecture.md');
}

function getNextAction(status: ProjectChange['status']): { title: string; description: string } {
  switch (status) {
    case 'draft':
    case 'designing':
      return {
        title: 'Finish the design draft',
        description: 'Update scope and design details, then request design review.',
      };
    case 'awaiting_design_review':
      return {
        title: 'Review the design',
        description: 'Approve the design or send it back for revision before planning begins.',
      };
    case 'planning':
      return {
        title: 'Prepare execution',
        description: 'Finalize execution/tasks docs, then request execution review.',
      };
    case 'awaiting_execution_review':
      return {
        title: 'Approve execution',
        description: 'Confirm the execution plan before the supervisor starts implementation.',
      };
    case 'executing':
      return {
        title: 'Wait for task execution or request acceptance',
        description: 'Once task-level work is done, move the change into acceptance review.',
      };
    case 'accepting':
      return {
        title: 'Review acceptance',
        description: 'Approve acceptance to move into sync, or reopen execution if more work is needed.',
      };
    case 'syncing':
      return {
        title: 'Complete the change',
        description: 'Review the sync summary and mark the change completed when specs are aligned.',
      };
    case 'completed':
      return {
        title: 'No action required',
        description: 'This change is complete and remains available as read-only history.',
      };
    case 'cancelled':
      return {
        title: 'No action required',
        description: 'This change has been cancelled and stays in history for reference.',
      };
    default:
      return {
        title: 'Review current state',
        description: 'Check the current change status and continue from the latest checkpoint.',
      };
  }
}
