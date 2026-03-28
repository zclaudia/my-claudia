import type {
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowTemplate,
  WorkflowStepTypeMeta,
} from '@my-claudia/shared';
import { apiCall, apiCallForBackend, apiCallVoid } from '../../services/api/unwrap';
import { useOwnershipStore } from '../../stores/ownershipStore';

function getProjectOwnerBackendId(projectId: string): string | null {
  return useOwnershipStore.getState().getProjectBackendId(projectId);
}

export async function listWorkflows(projectId: string): Promise<Workflow[]> {
  return apiCallForBackend<Workflow[]>(getProjectOwnerBackendId(projectId), `/api/projects/${projectId}/workflows`);
}

export async function listAllWorkflows(): Promise<Workflow[]> {
  return apiCall<Workflow[]>('/api/workflows');
}

export async function createGlobalWorkflow(data: { name: string; description?: string; definition: WorkflowDefinition; status?: string }): Promise<Workflow> {
  return apiCall<Workflow>('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getWorkflow(workflowId: string): Promise<Workflow> {
  return apiCall<Workflow>(`/api/workflows/${workflowId}`);
}

export async function createWorkflow(projectId: string, data: { name: string; description?: string; definition: WorkflowDefinition; status?: string }): Promise<Workflow> {
  return apiCallForBackend<Workflow>(getProjectOwnerBackendId(projectId), `/api/projects/${projectId}/workflows`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateWorkflow(workflowId: string, data: Partial<Workflow>): Promise<Workflow> {
  return apiCall<Workflow>(`/api/workflows/${workflowId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  return apiCallVoid(`/api/workflows/${workflowId}`, { method: 'DELETE' });
}

export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  return apiCall<WorkflowTemplate[]>('/api/workflow-templates');
}

export async function listWorkflowStepTypes(): Promise<WorkflowStepTypeMeta[]> {
  return apiCall<WorkflowStepTypeMeta[]>('/api/workflow-step-types');
}

export async function createWorkflowFromTemplate(projectId: string, templateId: string): Promise<Workflow> {
  return apiCallForBackend<Workflow>(
    getProjectOwnerBackendId(projectId),
    `/api/projects/${projectId}/workflows/from-template/${templateId}`,
    { method: 'POST' },
  );
}

export async function triggerWorkflow(workflowId: string): Promise<WorkflowRun> {
  return apiCall<WorkflowRun>(`/api/workflows/${workflowId}/trigger`, { method: 'POST' });
}

export async function listWorkflowRuns(workflowId: string, limit?: number): Promise<WorkflowRun[]> {
  const url = limit ? `/api/workflows/${workflowId}/runs?limit=${limit}` : `/api/workflows/${workflowId}/runs`;
  return apiCall<WorkflowRun[]>(url);
}

export async function getWorkflowRun(runId: string): Promise<{ run: WorkflowRun; stepRuns: WorkflowStepRun[] }> {
  return apiCall<{ run: WorkflowRun; stepRuns: WorkflowStepRun[] }>(`/api/workflow-runs/${runId}`);
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
  return apiCallVoid(`/api/workflow-runs/${runId}/cancel`, { method: 'POST' });
}

export async function approveWorkflowStep(stepRunId: string): Promise<void> {
  return apiCallVoid(`/api/workflow-step-runs/${stepRunId}/approve`, { method: 'POST' });
}

export async function rejectWorkflowStep(stepRunId: string): Promise<void> {
  return apiCallVoid(`/api/workflow-step-runs/${stepRunId}/reject`, { method: 'POST' });
}

// Workflow Generation (NL → Workflow)

export interface WorkflowGenerateResult {
  generationId: string;
  definition: WorkflowDefinition;
  name: string;
  description: string;
  warnings?: string[];
}

export async function generateWorkflowFromNL(
  projectId: string,
  description: string,
  providerId: string,
): Promise<WorkflowGenerateResult> {
  return apiCallForBackend<WorkflowGenerateResult>(
    getProjectOwnerBackendId(projectId),
    `/api/projects/${projectId}/workflows/generate`,
    { method: 'POST', body: JSON.stringify({ description, providerId }) },
  );
}

export async function refineGeneratedWorkflow(
  projectId: string,
  generationId: string,
  instruction: string,
): Promise<WorkflowGenerateResult> {
  return apiCallForBackend<WorkflowGenerateResult>(
    getProjectOwnerBackendId(projectId),
    `/api/projects/${projectId}/workflows/generate/refine`,
    { method: 'POST', body: JSON.stringify({ generationId, instruction }) },
  );
}
