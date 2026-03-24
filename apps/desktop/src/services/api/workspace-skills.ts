import { getBaseUrl, getAuthHeaders } from './base';
import { apiCall, apiCallVoid } from './unwrap';

export interface WorkspaceSkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
}

export async function getWorkspaceSkills(): Promise<WorkspaceSkillInfo[]> {
  return apiCall<WorkspaceSkillInfo[]>('/api/workspace/skills');
}

export async function getWorkspaceSkill(skillId: string): Promise<{ id: string; content: string }> {
  return apiCall<{ id: string; content: string }>(`/api/workspace/skills/${encodeURIComponent(skillId)}`);
}

export async function saveWorkspaceSkill(skillId: string, content: string): Promise<void> {
  return apiCallVoid(`/api/workspace/skills/${encodeURIComponent(skillId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

export async function deleteWorkspaceSkill(skillId: string): Promise<void> {
  return apiCallVoid(`/api/workspace/skills/${encodeURIComponent(skillId)}`, {
    method: 'DELETE',
  });
}

export interface RegisteredSkillTool {
  name: string;
  description: string;
}

export async function getRegisteredSkillTools(): Promise<RegisteredSkillTool[]> {
  // Uses raw fetch with different error handling — returns [] on failure
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
  return apiCall<string[]>('/api/workspace/skill-dirs');
}

export async function saveExternalSkillDirs(dirs: string[]): Promise<void> {
  return apiCallVoid('/api/workspace/skill-dirs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dirs }),
  });
}
