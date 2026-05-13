import { useState, useEffect, useCallback } from 'react';
import {
  Plus, RefreshCw, Play, Trash2,
  FolderOpen, Globe, Pencil, Eye, Shield,
} from 'lucide-react';
import type { Workflow, WorkflowTemplate } from '@my-claudia/shared';
import type { AutomationApiType } from './useAutomationApi';
import type { ProjectInfo } from './automation-types';
import { isInternalProject, projectSelectOptions, CATEGORY_COLORS } from './automation-types';
import { Select } from '../../components/ui/Select';
import { isDesktopTauri } from '../../utils/platform';
import { buildPopoutUrl, openPopoutWindow } from '../../utils/popoutWindow';
import { LoadingState, EmptyState } from './AutomationSharedComponents';

const PERMISSION_FALLBACK_TEMPLATE_ID = 'permission-escalation-default';

interface WorkflowsTabProps {
  api: AutomationApiType;
  projects: ProjectInfo[];
  globalPermissionWorkflowOverrideId: string | null;
  projectName: (id?: string) => string;
  serverUrl: string;
  selectedBackendId: string | null;
  initialProjectId?: string;
}

export function WorkflowsTab({ api, projects, globalPermissionWorkflowOverrideId, projectName, serverUrl, selectedBackendId, initialProjectId }: WorkflowsTabProps) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [createProjectId, setCreateProjectId] = useState(initialProjectId ?? '');

  const effectiveProjectId = createProjectId || projects[0]?.id || '';
  const selectedProject = projects.find(p => p.id === effectiveProjectId);
  const selectedIsGlobal = selectedProject ? isInternalProject(selectedProject.name) : false;

  const getBindingBadges = useCallback((workflow: Workflow) => {
    const badges: Array<{ label: string; className: string }> = [];
    const boundProjects = projects.filter((project) => project.permissionWorkflowOverrideId === workflow.id);
    const projectBinding = boundProjects.find((project) => project.id === workflow.projectId);
    if (projectBinding) {
      badges.push({ label: 'Project override', className: 'bg-primary/10 text-primary border-primary/20' });
    } else if (boundProjects.length > 0) {
      badges.push({ label: `${boundProjects.length} project override${boundProjects.length === 1 ? '' : 's'}`, className: 'bg-primary/10 text-primary border-primary/20' });
    }
    if (globalPermissionWorkflowOverrideId === workflow.id) {
      badges.push({ label: 'Global override', className: 'bg-success/10 text-success border-success/20' });
    }
    return badges;
  }, [globalPermissionWorkflowOverrideId, projects]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Global view shows workflows with project_id IS NULL (truly global + system fallback),
      // which won't match the internal __global project id. Fetch unscoped and filter.
      const query = selectedIsGlobal || !effectiveProjectId
        ? ''
        : `?projectId=${encodeURIComponent(effectiveProjectId)}`;
      const [wfs, tpls] = await Promise.all([
        api.get(`/api/workflows${query}`),
        api.get('/api/workflow-templates'),
      ]);
      const scoped = selectedIsGlobal
        ? wfs.filter((w: Workflow) => !w.projectId)
        : wfs;
      // Filter out simple automations — they belong in Automations tab
      setWorkflows(scoped.filter((w: Workflow) => w.authoringMode !== 'simple'));
      setTemplates(tpls.filter((template: WorkflowTemplate) => template.id !== PERMISSION_FALLBACK_TEMPLATE_ID));
    } catch { /* ignore */ }
    setLoading(false);
  }, [api, effectiveProjectId, selectedIsGlobal]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleTrigger = async (id: string) => {
    await api.post(`/api/workflows/${id}/trigger`).catch(() => {});
    refresh();
  };

  const handleDelete = async (id: string) => {
    await api.del(`/api/workflows/${id}`).catch(() => {});
    setWorkflows(prev => prev.filter(w => w.id !== id));
  };

  const handleEnableTemplate = async (templateId: string, projectId: string) => {
    await api.post(`/api/projects/${projectId}/workflows/from-template/${templateId}`).catch(() => {});
    refresh();
  };

  const handleCreate = async () => {
    if (!effectiveProjectId) return;
    const name = `New Workflow ${new Date().toLocaleTimeString()}`;
    await api.post(`/api/projects/${effectiveProjectId}/workflows`, {
      name,
      definition: { nodes: [], edges: [], entryNodeId: '', triggers: [{ type: 'manual' }] },
    }).catch(() => {});
    refresh();
  };

  const handleEdit = (w: Workflow, readOnly?: boolean) => {
    const params: Record<string, string> = {
      workflowEditor: w.projectId || effectiveProjectId,
      workflowId: w.id,
      ...(serverUrl ? { serverUrl } : {}),
      ...(readOnly ? { readOnly: '1' } : {}),
    };
    if (isDesktopTauri()) {
      void openPopoutWindow({
        type: 'workflow-editor',
        params,
        title: readOnly ? `View: ${w.name}` : `Edit: ${w.name}`,
        width: 1200,
        height: 800,
        connectionTarget: { backendId: selectedBackendId },
      });
      return;
    }
    window.open(buildPopoutUrl(params, { backendId: selectedBackendId }), '_blank', 'width=1200,height=800');
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{workflows.length} workflow{workflows.length !== 1 ? 's' : ''}</h2>
        <div className="flex items-center gap-1.5">
          {projects.length > 0 && (
            <Select
              value={effectiveProjectId}
              onChange={setCreateProjectId}
              size="md"
              align="right"
              triggerClassName="min-w-[160px]"
              options={projectSelectOptions(projects)}
            />
          )}
          <button
            onClick={handleCreate}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus size={12} />
            New
          </button>
          <button onClick={refresh} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Templates */}
      {templates.length > 0 && !selectedIsGlobal && (
        <div>
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Quick Start Templates</h3>
          <div className="grid grid-cols-3 gap-2">
            {templates.map(t => {
              const enabled = workflows.some(w => w.templateId === t.id);
              return (
                <div key={t.id} className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{t.name}</div>
                      {t.description && <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{t.description}</div>}
                    </div>
                    {(t as any).category && (
                      <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-medium shrink-0 ${CATEGORY_COLORS[(t as any).category] ?? 'bg-muted text-muted-foreground'}`}>
                        {(t as any).category}
                      </span>
                    )}
                  </div>
                  {effectiveProjectId && (
                    <button
                      onClick={() => handleEnableTemplate(t.id, effectiveProjectId)}
                      disabled={enabled}
                      className={`self-start text-[10px] px-2 py-0.5 rounded-md transition-colors ${
                        enabled ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary hover:bg-primary/20'
                      }`}
                    >
                      {enabled ? 'Enabled' : 'Enable'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Workflow List */}
      {workflows.length === 0 ? (
        <EmptyState message="No workflows yet" subtitle="Create one or enable a template to get started" />
      ) : (
        <div className="space-y-2">
          {workflows.map(w => {
            const isSystem = !!w.isSystem;
            return (
            <div
              key={w.id}
              className={`rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3 cursor-pointer hover:bg-secondary/30 transition-colors ${isSystem ? 'opacity-80' : ''}`}
              onClick={() => handleEdit(w, isSystem)}
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${w.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-medium truncate">{w.name}</div>
                  {isSystem && (
                    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium shrink-0 bg-muted/50 text-muted-foreground border-muted">
                      <Shield size={9} />
                      System Default
                    </span>
                  )}
                  {getBindingBadges(w).map((badge) => (
                    <span
                      key={`${w.id}-${badge.label}`}
                      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    {w.projectId ? <FolderOpen size={10} /> : <Globe size={10} />}
                    {projectName(w.projectId)}
                  </span>
                  {w.description && <><span>·</span><span className="truncate">{w.description}</span></>}
                  {w.definition.nodes.length > 0 && <><span>·</span><span>{w.definition.nodes.length} nodes</span></>}
                </div>
              </div>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {isSystem ? (
                  <button onClick={() => handleEdit(w, true)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground" title="View">
                    <Eye size={12} />
                  </button>
                ) : (
                  <>
                    <button onClick={() => handleEdit(w)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground" title="Edit">
                      <Pencil size={12} />
                    </button>
                    {w.status === 'active' && (
                      <button onClick={() => handleTrigger(w.id)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground" title="Trigger">
                        <Play size={12} />
                      </button>
                    )}
                    <button onClick={() => handleDelete(w.id)} className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-red-400" title="Delete">
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
