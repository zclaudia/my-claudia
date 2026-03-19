import type { SlashCommand, CommandExecuteRequest, CommandExecuteResponse } from '@my-claudia/shared';
import { fetchApi } from './base';

export interface CommandListResponse {
  builtin: SlashCommand[];
  custom: SlashCommand[];
  count: number;
}

export async function listCommands(projectPath?: string): Promise<CommandListResponse> {
  const result = await fetchApi<CommandListResponse>('/api/commands/list', {
    method: 'POST',
    body: JSON.stringify({ projectPath })
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to list commands');
  }
  return result.data;
}

export async function executeCommand(request: CommandExecuteRequest): Promise<CommandExecuteResponse> {
  const result = await fetchApi<CommandExecuteResponse>('/api/commands/execute', {
    method: 'POST',
    body: JSON.stringify(request)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to execute command');
  }
  return result.data;
}
