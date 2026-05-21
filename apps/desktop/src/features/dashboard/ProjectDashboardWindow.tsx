import { useEffect, useMemo, useState } from 'react';
import type { Project } from '@my-claudia/shared';
import * as api from '../../services/api';
import { WindowContextBar } from '../../components/window/WindowContextBar';
import { useProjectStore } from '../../stores/projectStore';
import { useGatewayStore } from '../../stores/gatewayStore';
import { useServerStore } from '../../stores/serverStore';
import { ProjectDashboard } from './ProjectDashboard';
import { openAutomationWindow } from '../automation/openAutomationWindow';

interface ProjectDashboardWindowProps {
  projectId: string;
  serverUrl: string;
  serverId?: string;
  serverName?: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
}

export function ProjectDashboardWindow({
  projectId,
  serverUrl,
  serverId,
  serverName,
  gatewayUrl,
  gatewaySecret,
}: ProjectDashboardWindowProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serverId) {
      useServerStore.getState().setActiveServer(serverId);
    }
    if (serverUrl) {
      try {
        const raw = serverUrl.startsWith('http') ? serverUrl : `http://${serverUrl}`;
        const port = Number.parseInt(new URL(raw).port, 10);
        if (port) useServerStore.getState().setLocalServerPort(port);
      } catch {
        // Ignore malformed standalone URLs; API calls will surface the failure.
      }
    }
    if (gatewayUrl && gatewaySecret) {
      useGatewayStore.setState({ gatewayUrl, gatewaySecret });
    }
  }, [gatewaySecret, gatewayUrl, serverId, serverUrl]);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        setError(null);
        const projects = await api.getProjectsForBackend(serverId ?? null);
        if (cancelled) return;

        const backendId = serverId ?? useServerStore.getState().activeServerId;
        if (backendId) {
          useProjectStore.getState().replaceProjectsForBackend(backendId, projects);
        } else {
          useProjectStore.getState().setProjects(projects);
        }
        const nextProject = projects.find((item) => item.id === projectId) ?? null;
        setProject(nextProject);
        if (!nextProject) {
          setError('Project not found');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load project dashboard');
        }
      }
    }

    void loadProject();
    return () => {
      cancelled = true;
    };
  }, [projectId, serverId]);

  const automationOpener = useMemo(
    () => (opts?: Parameters<typeof openAutomationWindow>[0]) => {
      void openAutomationWindow(opts ?? {});
    },
    [],
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground safe-top-pad">
      {serverName && (
        <WindowContextBar serverName={serverName} projectId={projectId} />
      )}
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {error}
          </div>
        ) : project ? (
          <ProjectDashboard
            projectId={project.id}
            projectRootPath={project.rootPath}
            onOpenAutomations={automationOpener}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading dashboard...
          </div>
        )}
      </div>
    </div>
  );
}
