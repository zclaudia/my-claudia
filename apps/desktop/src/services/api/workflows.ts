import type {
  Workflow,
  WorkflowDefinition,
  WorkflowDefinitionV2,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowTemplate,
  WorkflowStepTypeMeta,
} from '@my-claudia/shared';
import { fetchApi } from './base';

export async function listWorkflows(projectId: string): Promise<Workflow[]> {
  const result = await fetchApi<Workflow[]>(`/api/projects/${projectId}/workflows`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list workflows');
  return result.data;
}

export async function getWorkflow(workflowId: string): Promise<Workflow> {
  const result = await fetchApi<Workflow>(`/api/workflows/${workflowId}`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to get workflow');
  return result.data;
}

export async function createWorkflow(projectId: string, data: { name: string; description?: string; definition: WorkflowDefinition; status?: string }): Promise<Workflow> {
  const result = await fetchApi<Workflow>(`/api/projects/${projectId}/workflows`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to create workflow');
  return result.data;
}

export async function updateWorkflow(workflowId: string, data: Partial<Workflow>): Promise<Workflow> {
  const result = await fetchApi<Workflow>(`/api/workflows/${workflowId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to update workflow');
  return result.data;
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/workflows/${workflowId}`, { method: 'DELETE' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to delete workflow');
}

export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const result = await fetchApi<WorkflowTemplate[]>('/api/workflow-templates');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list templates');
  return result.data;
}

export async function listWorkflowStepTypes(): Promise<WorkflowStepTypeMeta[]> {
  const result = await fetchApi<WorkflowStepTypeMeta[]>('/api/workflow-step-types');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list step types');
  return result.data;
}

export async function createWorkflowFromTemplate(projectId: string, templateId: string): Promise<Workflow> {
  const result = await fetchApi<Workflow>(
    `/api/projects/${projectId}/workflows/from-template/${templateId}`,
    { method: 'POST' },
  );
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to create from template');
  return result.data;
}

export async function triggerWorkflow(workflowId: string): Promise<WorkflowRun> {
  const result = await fetchApi<WorkflowRun>(`/api/workflows/${workflowId}/trigger`, { method: 'POST' });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to trigger workflow');
  return result.data;
}

export async function listWorkflowRuns(workflowId: string, limit?: number): Promise<WorkflowRun[]> {
  const url = limit ? `/api/workflows/${workflowId}/runs?limit=${limit}` : `/api/workflows/${workflowId}/runs`;
  const result = await fetchApi<WorkflowRun[]>(url);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list runs');
  return result.data;
}

export async function getWorkflowRun(runId: string): Promise<{ run: WorkflowRun; stepRuns: WorkflowStepRun[] }> {
  const result = await fetchApi<{ run: WorkflowRun; stepRuns: WorkflowStepRun[] }>(`/api/workflow-runs/${runId}`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to get run');
  return result.data;
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/workflow-runs/${runId}/cancel`, { method: 'POST' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to cancel run');
}

export async function approveWorkflowStep(stepRunId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/workflow-step-runs/${stepRunId}/approve`, { method: 'POST' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to approve step');
}

export async function rejectWorkflowStep(stepRunId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/workflow-step-runs/${stepRunId}/reject`, { method: 'POST' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to reject step');
}

// Workflow Generation (NL → Workflow)

export interface WorkflowGenerateResult {
  generationId: string;
  definition: WorkflowDefinitionV2;
  name: string;
  description: string;
  warnings?: string[];
}

export async function generateWorkflowFromNL(
  projectId: string,
  description: string,
  providerId: string,
): Promise<WorkflowGenerateResult> {
  const result = await fetchApi<WorkflowGenerateResult>(
    `/api/projects/${projectId}/workflows/generate`,
    { method: 'POST', body: JSON.stringify({ description, providerId }) },
  );
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to generate workflow');
  return result.data;
}

export async function refineGeneratedWorkflow(
  projectId: string,
  generationId: string,
  instruction: string,
): Promise<WorkflowGenerateResult> {
  const result = await fetchApi<WorkflowGenerateResult>(
    `/api/projects/${projectId}/workflows/generate/refine`,
    { method: 'POST', body: JSON.stringify({ generationId, instruction }) },
  );
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to refine workflow');
  return result.data;
}
