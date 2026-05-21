import { buildPopoutUrl, buildWindowTitle, getConnectionParams } from '../../utils/popoutWindow';
import { useOwnershipStore } from '../../stores/ownershipStore';

function dashboardWindowLabel(projectId: string): string {
  return `project-dashboard-${projectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export interface OpenProjectDashboardWindowOptions {
  projectId: string;
  projectName?: string;
}

export async function openProjectDashboardWindow({
  projectId,
  projectName,
}: OpenProjectDashboardWindowOptions): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = dashboardWindowLabel(projectId);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const ownerBackendId = useOwnershipStore.getState().getProjectBackendId(projectId);
  const connectionTarget = { backendId: ownerBackendId };
  const url = buildPopoutUrl({ projectDashboard: projectId }, connectionTarget);
  const conn = getConnectionParams(connectionTarget);

  new WebviewWindow(label, {
    url,
    title: buildWindowTitle(projectName ? `${projectName} Dashboard` : 'Project Dashboard', conn.serverName),
    width: 1200,
    height: 780,
    center: true,
    dragDropEnabled: false,
  });
}
