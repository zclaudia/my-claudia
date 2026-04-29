/**
 * Automation management window — standalone Tauri window.
 *
 * Tabs:
 *   - Workflows: full DAG workflows (graph editor)
 *   - Automations: simple single-action automations (schedule/event + prompt/shell/webhook)
 *   - System: internal system tasks (readonly)
 */

import { useState, useEffect, useCallback } from 'react';
import { Zap, Clock, Server, History } from 'lucide-react';
import { useFacadeStore } from '../../stores/facadeStore';
import { useServerStore } from '../../stores/serverStore';
import { useAutomationApi } from './useAutomationApi';
import {
  resolveInitialAutomationBackendId,
  useAutomationBackendOptions,
} from './useAutomationBackendOptions';
import type { ProjectInfo, AgentConfigInfo } from './automation-types';
import { isInternalProject } from './automation-types';
import { AutomationBackendSelector } from './AutomationSharedComponents';
import { AutomationsTab } from './AutomationsTab';
import { WorkflowsTab } from './WorkflowsTab';
import { RunsTab } from './RunsTab';
import { SystemTasksTab } from './SystemTasksTab';

interface AutomationWindowProps {
  serverUrl: string;
  authToken: string;
  serverId?: string;
}

type Tab = 'workflows' | 'automations' | 'runs' | 'system';

// ── Main Component ───────────────────────────────────────────

export function AutomationWindow({ serverUrl, authToken, serverId }: AutomationWindowProps) {
  const [tab, setTab] = useState<Tab>('automations');
  const backendOptions = useAutomationBackendOptions();
  const localBackendId = useFacadeStore((state) => state.localBackendId);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedBackendId((prev) => {
      const resolved = resolveInitialAutomationBackendId({
        preferredBackendId: prev || serverId,
        activeServerId,
        localBackendId,
        options: backendOptions,
      });
      return resolved !== prev ? resolved : prev;
    });
  }, [activeServerId, backendOptions, localBackendId, serverId]);

  const selectedBackend = backendOptions.find((option) => option.backendId === selectedBackendId) ?? null;
  const api = useAutomationApi(selectedBackend?.backendId ?? null, serverUrl, authToken);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [globalPermissionWorkflowOverrideId, setGlobalPermissionWorkflowOverrideId] = useState<string | null>(null);
  useEffect(() => {
    setProjects([]);
    setGlobalPermissionWorkflowOverrideId(null);
    Promise.all([
      api.get('/api/projects'),
      api.get('/api/agent/config').catch(() => null),
    ]).then(([projectData, agentConfig]) => {
      setProjects(projectData);
      setGlobalPermissionWorkflowOverrideId((agentConfig as AgentConfigInfo | null)?.permissionWorkflowOverrideId ?? null);
    }).catch(() => {});
  }, [api]);

  const projectName = useCallback((projectId?: string) => {
    if (!projectId) return 'Global';
    const project = projects.find(p => p.id === projectId);
    if (!project) return projectId.slice(0, 8);
    return isInternalProject(project.name) ? 'Global' : project.name;
  }, [projects]);

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'automations', label: 'Automations', icon: <Zap size={14} /> },
    { key: 'workflows', label: 'Workflows', icon: <Clock size={14} /> },
    { key: 'runs', label: 'Runs', icon: <History size={14} /> },
    { key: 'system', label: 'System', icon: <Server size={14} /> },
  ];
  const scopeKey = selectedBackendId || 'fallback';

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50">
        <Zap size={18} className="text-primary" />
        <h1 className="text-sm font-semibold">
          Automation{selectedBackend ? ` · ${selectedBackend.name}` : ''}
        </h1>
        <AutomationBackendSelector
          options={backendOptions}
          selectedBackendId={selectedBackendId}
          onSelect={setSelectedBackendId}
        />
        <div className="flex-1" />
        <div className="flex gap-1 bg-secondary/50 rounded-lg p-0.5">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === t.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {tab === 'automations' && (
          <AutomationsTab
            key={`automations-${scopeKey}`}
            api={api}
            projects={projects}
            projectName={projectName}
          />
        )}
        {tab === 'workflows' && (
          <WorkflowsTab
            key={`workflows-${scopeKey}`}
            api={api}
            projects={projects}
            globalPermissionWorkflowOverrideId={globalPermissionWorkflowOverrideId}
            projectName={projectName}
            serverUrl={serverUrl}
            selectedBackendId={selectedBackendId}
          />
        )}
        {tab === 'runs' && (
          <RunsTab
            key={`runs-${scopeKey}`}
            api={api}
            projects={projects}
          />
        )}
        {tab === 'system' && <SystemTasksTab key={`system-${scopeKey}`} api={api} />}
      </div>
    </div>
  );
}
