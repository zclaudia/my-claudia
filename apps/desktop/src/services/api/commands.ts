import type { CommandExecuteRequest, CommandExecuteResponse } from '@my-claudia/shared';
import { apiCall } from './unwrap';

export interface CommandListResponse {
  builtin: import('@my-claudia/shared').SlashCommand[];
  custom: import('@my-claudia/shared').SlashCommand[];
  count: number;
}

export async function listCommands(projectPath?: string): Promise<CommandListResponse> {
  return apiCall<CommandListResponse>('/api/commands/list', {
    method: 'POST',
    body: JSON.stringify({ projectPath })
  });
}

export async function executeCommand(request: CommandExecuteRequest): Promise<CommandExecuteResponse> {
  return apiCall<CommandExecuteResponse>('/api/commands/execute', {
    method: 'POST',
    body: JSON.stringify(request)
  });
}
