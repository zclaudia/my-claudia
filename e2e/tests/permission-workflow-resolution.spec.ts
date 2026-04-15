import { describe, test, expect, beforeEach } from 'vitest';
import { getServerBaseUrl, setupCleanDB } from '../helpers/setup';

type ApiEnvelope<T> = { success: boolean; data?: T; error?: { message?: string } };

describe('Permission Workflow Resolution', () => {
  beforeEach(async () => {
    await setupCleanDB();
  }, 30000);

  test('prefers project override, then global override, then system fallback', async () => {
    const base = getServerBaseUrl();
    const definition = { nodes: [], edges: [], entryNodeId: '', triggers: [{ type: 'manual' }] };

    async function api<T>(path: string, init?: RequestInit): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      const raw = await response.text();
      let json: ApiEnvelope<T> | null = null;
      if (raw) {
        try {
          json = JSON.parse(raw) as ApiEnvelope<T>;
        } catch {
          throw new Error(
            JSON.stringify({
              path,
              status: response.status,
              statusText: response.statusText,
              body: raw.slice(0, 300),
            }),
          );
        }
      }
      if (!response.ok || !json?.success) {
        throw new Error(
          JSON.stringify({
            path,
            status: response.status,
            statusText: response.statusText,
            body: json ?? raw,
          }),
        );
      }
      return json.data as T;
    }

    const project = await api<{ id: string }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Resolver E2E Project' }),
    });

    const globalWorkflow = await api<{ id: string }>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: 'Global Override Workflow', definition }),
    });

    const projectWorkflow = await api<{ id: string }>(`/api/projects/${project.id}/workflows`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Project Override Workflow', definition }),
    });

    await api('/api/agent/config', {
      method: 'PUT',
      body: JSON.stringify({ permissionWorkflowOverrideId: globalWorkflow.id }),
    });

    await api(`/api/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({ permissionWorkflowOverrideId: projectWorkflow.id }),
    });

    const projectResolved = await api<{
      source: string;
      workflowId: string;
      workflow: { isSystem: boolean };
    }>('/api/debug/resolve-permission-workflow', {
      method: 'POST',
      body: JSON.stringify({ projectId: project.id }),
    });

    await api(`/api/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({ permissionWorkflowOverrideId: null }),
    });

    const globalResolved = await api<{
      source: string;
      workflowId: string;
      workflow: { isSystem: boolean };
    }>('/api/debug/resolve-permission-workflow', {
      method: 'POST',
      body: JSON.stringify({ projectId: project.id }),
    });

    await api('/api/agent/config', {
      method: 'PUT',
      body: JSON.stringify({ permissionWorkflowOverrideId: null }),
    });

    const fallbackResolved = await api<{
      source: string;
      workflowId: string;
      workflow: { isSystem: boolean };
    }>('/api/debug/resolve-permission-workflow', {
      method: 'POST',
      body: JSON.stringify({ projectId: project.id }),
    });

    const result = {
      projectId: project.id,
      globalWorkflowId: globalWorkflow.id,
      projectWorkflowId: projectWorkflow.id,
      projectResolved,
      globalResolved,
      fallbackResolved,
    };

    expect(result.projectResolved).toMatchObject({
      source: 'project_override',
      workflowId: result.projectWorkflowId,
    });
    expect(result.globalResolved).toMatchObject({
      source: 'global_override',
      workflowId: result.globalWorkflowId,
    });
    expect(result.fallbackResolved.source).toBe('system_fallback');
    expect(result.fallbackResolved.workflow.isSystem).toBe(true);
  });
});
