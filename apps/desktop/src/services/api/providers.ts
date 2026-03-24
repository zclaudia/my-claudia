import type { ProviderConfig, ProviderCapabilities, SlashCommand } from '@my-claudia/shared';
import { fetchApi, fetchLocalApi, activeServerSupports } from './base';
import { apiCall, apiCallVoid } from './unwrap';

export async function getProviders(options?: RequestInit): Promise<ProviderConfig[]> {
  return apiCall<ProviderConfig[]>('/api/providers', options);
}

export async function createProvider(data: {
  name: string;
  type?: string;
  cliPath?: string;
  env?: Record<string, string>;
  isDefault?: boolean;
}): Promise<ProviderConfig> {
  return apiCall<ProviderConfig>('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateProvider(
  id: string,
  data: Partial<ProviderConfig>
): Promise<void> {
  return apiCallVoid(`/api/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteProvider(id: string): Promise<void> {
  return apiCallVoid(`/api/providers/${id}`, { method: 'DELETE' });
}

export async function setDefaultProvider(id: string): Promise<void> {
  if (!activeServerSupports('setDefaultProvider')) {
    console.warn('[API] setDefaultProvider not supported by active server, skipping');
    return;
  }
  return apiCallVoid(`/api/providers/${id}/set-default`, { method: 'POST' });
}

// Functions below use activeServerSupports + fallback logic — keep using fetchApi directly

export async function getProviderCommands(
  providerId: string,
  projectRoot?: string,
  options?: RequestInit
): Promise<SlashCommand[]> {
  const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : '';
  if (activeServerSupports('providerCommands')) {
    const result = await fetchApi<SlashCommand[]>(`/api/providers/${providerId}/commands${query}`, options);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<SlashCommand[]>(`/api/providers/type/claude/commands${query}`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider commands');
  }
  return localResult.data;
}

export async function getProviderTypeCommands(
  providerType: string,
  projectRoot?: string,
  options?: RequestInit
): Promise<SlashCommand[]> {
  const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : '';
  if (activeServerSupports('providerCommands')) {
    const result = await fetchApi<SlashCommand[]>(`/api/providers/type/${providerType}/commands${query}`, options);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<SlashCommand[]>(`/api/providers/type/${providerType}/commands${query}`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider type commands');
  }
  return localResult.data;
}

export async function getProviderCapabilities(
  providerId: string,
  options?: RequestInit
): Promise<ProviderCapabilities> {
  if (activeServerSupports('providerCapabilities')) {
    const result = await fetchApi<ProviderCapabilities>(`/api/providers/${providerId}/capabilities`, options);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<ProviderCapabilities>(`/api/providers/type/claude/capabilities`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider capabilities');
  }
  return localResult.data;
}

export async function getProviderTypeCapabilities(
  providerType: string,
  options?: RequestInit
): Promise<ProviderCapabilities> {
  if (activeServerSupports('providerCapabilities')) {
    const result = await fetchApi<ProviderCapabilities>(`/api/providers/type/${providerType}/capabilities`, options);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<ProviderCapabilities>(`/api/providers/type/${providerType}/capabilities`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider type capabilities');
  }
  return localResult.data;
}
