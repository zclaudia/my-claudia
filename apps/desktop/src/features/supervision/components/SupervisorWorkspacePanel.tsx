import { useEffect, useMemo, useState } from 'react';
import type { AcceptanceDecision, ExecutionGateDecision, ProjectAgent, ProjectChange, ProviderConfig } from '@my-claudia/shared';
import * as api from '../../../services/api';
import { useSupervisionStore } from '../store';
import { TaskBoard } from './TaskBoard';
import { BaselineSetupPanel } from './BaselineSetupPanel';
import { ActiveChangeCard } from './ActiveChangeCard';
import { RecentChangesPanel } from './RecentChangesPanel';
import { AllChangesPanel } from './AllChangesPanel';
import { WorkspaceDocsPanel } from './WorkspaceDocsPanel';
import {
  type ContextDocumentPreview,
  type PreviewDocTarget,
  extractWorkspaceDocs,
  hasBaselineDocs,
} from './supervisor-utils';

interface SupervisorWorkspacePanelProps {
  projectId: string;
  agent: ProjectAgent | null;
}

type BaselineSetupMode = 'template' | 'scan' | 'ai_scan';
type BaselineSetupLanguage = 'zh-CN' | 'en';

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

  const handleGateAction = async (
    action: () => Promise<ProjectChange>,
    errorMessage: string,
  ) => {
    if (!activeChange) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await action();
      await refreshActiveChange(updated);
      setActionNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestDesign = () =>
    handleGateAction(
      () => api.requestDesignGate(activeChange!.id, actionNotes.trim() || undefined),
      'Failed to request design review',
    );

  const handleResolveDesign = (decision: 'approve_design' | 'revise_design' | 'revise_change') =>
    handleGateAction(
      () => api.resolveDesignGate(activeChange!.id, decision, actionNotes.trim() || undefined),
      'Failed to resolve design gate',
    );

  const handleRequestExecution = () =>
    handleGateAction(
      () => api.requestExecutionGate(activeChange!.id, actionNotes.trim() || undefined),
      'Failed to request execution review',
    );

  const handleResolveExecution = (decision: ExecutionGateDecision) =>
    handleGateAction(
      () => api.resolveExecutionGate(activeChange!.id, decision, actionNotes.trim() || undefined),
      'Failed to resolve execution gate',
    );

  const handleRequestAcceptance = () =>
    handleGateAction(
      () => api.requestAcceptance(activeChange!.id, actionNotes.trim() || undefined),
      'Failed to request acceptance',
    );

  const handleResolveAcceptance = (decision: AcceptanceDecision) =>
    handleGateAction(
      () => api.resolveAcceptance(activeChange!.id, decision, actionNotes.trim() || undefined),
      'Failed to resolve acceptance',
    );

  const handleRequestSync = () =>
    handleGateAction(
      () => api.requestChangeSync(activeChange!.id, actionNotes.trim() || undefined),
      'Failed to request sync',
    );

  const handleCompleteChange = () =>
    handleGateAction(
      () => api.completeProjectChange(activeChange!.id, actionNotes.trim() || undefined),
      'Failed to complete change',
    );

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
    const docType = selectedDoc ? (selectedDoc.id.split('/').pop()?.replace('.md', '') ?? '') : '';
    const isEditableDocType = ['project', 'architecture', 'design', 'execution', 'tasks'].includes(docType);
    if (!selectedDoc || !isEditableDocType) return;
    setLoading(true);
    setError(null);
    try {
      if (selectedDoc.id.startsWith('baseline/')) {
        await api.updateBaselineDocument(projectId, docType as 'project' | 'architecture', draftDocContent);
        const contextDocs = await api.getSupervisionContext(projectId);
        setBaselineReady(hasBaselineDocs(contextDocs));
        const nextDocs = extractWorkspaceDocs(activeChange?.id, contextDocs);
        setDocs(nextDocs);
        setSelectedDocId(selectedDoc.id);
      } else {
        if (!activeChange) return;
        const updated = await api.updateChangeDocument(activeChange.id, docType as 'design' | 'execution' | 'tasks', draftDocContent);
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
          <BaselineSetupPanel
            loading={loading}
            baselineReady={baselineReady}
            baselineMode={baselineMode}
            baselineLanguage={baselineLanguage}
            baselineProviderId={baselineProviderId}
            aiCapableProviders={aiCapableProviders}
            onModeChange={setBaselineMode}
            onLanguageChange={setBaselineLanguage}
            onProviderChange={setBaselineProviderId}
            onCancel={() => setShowBaselineSetup(false)}
            onSubmit={handleInitBaseline}
          />
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
          <ActiveChangeCard
            activeChange={activeChange}
            executionPlan={executionPlan}
            changeTasks={changeTasks}
            actionNotes={actionNotes}
            loading={loading}
            onActionNotesChange={setActionNotes}
            onRequestDesign={handleRequestDesign}
            onResolveDesign={handleResolveDesign}
            onRequestExecution={handleRequestExecution}
            onResolveExecution={handleResolveExecution}
            onRequestAcceptance={handleRequestAcceptance}
            onResolveAcceptance={handleResolveAcceptance}
            onRequestSync={handleRequestSync}
            onCompleteChange={handleCompleteChange}
          />
        )}

        <RecentChangesPanel
          recentHistory={recentHistory}
          previewChangeId={previewChangeId}
          showAllChanges={showAllChanges}
          loading={loading}
          onToggleShowAll={() => setShowAllChanges((value) => !value)}
          onPreviewChange={handlePreviewChange}
        />

        {showAllChanges && allChanges.length > 0 && (
          <AllChangesPanel
            filteredChanges={filteredChanges}
            changesFilter={changesFilter}
            previewChangeId={previewChangeId}
            loading={loading}
            onFilterChange={setChangesFilter}
            onPreviewChange={(change) => handlePreviewChange(change)}
          />
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
            <WorkspaceDocsPanel
              docs={docs}
              selectedDocId={selectedDocId}
              previewChange={previewChange}
              activeChange={activeChange}
              editingDocId={editingDocId}
              draftDocContent={draftDocContent}
              loading={loading}
              onSelectDoc={setSelectedDocId}
              onStartEditing={handleStartEditing}
              onCancelEditing={handleCancelEditing}
              onSaveDocument={handleSaveDocument}
              onDraftContentChange={setDraftDocContent}
              onBackToActive={() => void handlePreviewChange(activeChange!)}
            />
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
