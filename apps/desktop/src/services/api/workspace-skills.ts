import { fetchApi, getBaseUrl, getAuthHeaders } from './base';

export interface WorkspaceSkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
}

export async function getWorkspaceSkills(): Promise<WorkspaceSkillInfo[]> {
  const result = await fetchApi<WorkspaceSkillInfo[]>('/api/workspace/skills');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch skills');
  }
  return result.data;
}

export async function getWorkspaceSkill(skillId: string): Promise<{ id: string; content: string }> {
  const result = await fetchApi<{ id: string; content: string }>(`/api/workspace/skills/${encodeURIComponent(skillId)}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch skill');
  }
  return result.data;
}

export async function saveWorkspaceSkill(skillId: string, content: string): Promise<void> {
  const result = await fetchApi<unknown>(`/api/workspace/skills/${encodeURIComponent(skillId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to save skill');
  }
}

export async function deleteWorkspaceSkill(skillId: string): Promise<void> {
  const result = await fetchApi<unknown>(`/api/workspace/skills/${encodeURIComponent(skillId)}`, {
    method: 'DELETE',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete skill');
  }
}

export interface RegisteredSkillTool {
  name: string;
  description: string;
}

export async function getRegisteredSkillTools(): Promise<RegisteredSkillTool[]> {
  try {
    const baseUrl = getBaseUrl();
    const response = await fetch(`${baseUrl}/api/plugins/tools`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json() as { tools?: Array<{ name: string; description?: string }> };
    if (!data.tools) return [];
    return data.tools
      .filter(t => t.name.startsWith('skill__'))
      .map(t => ({ name: t.name, description: t.description || '' }));
  } catch {
    return [];
  }
}

export async function getExternalSkillDirs(): Promise<string[]> {
  const result = await fetchApi<string[]>('/api/workspace/skill-dirs');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch skill dirs');
  }
  return result.data;
}

export async function saveExternalSkillDirs(dirs: string[]): Promise<void> {
  const result = await fetchApi<unknown>('/api/workspace/skill-dirs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirs }),
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update skill dirs');
  }
}
