// API service - re-exports all API functions from sub-modules.
// Consumers can continue importing from '../services/api' without changes.

// Base utilities
export { AuthError, getBaseUrl, getAuthHeaders, fetchApi, fetchLocalApi } from './api/base';
export { apiCall, apiCallVoid } from './api/unwrap';

// Domain APIs
export * from './api/projects';
export * from './api/sessions';
export * from './api/session-drafts';
export * from './api/session-search';
export * from './api/providers';
export * from './api/servers';
export * from './api/supervision';
export * from '../features/local-pr/api';
export * from '../features/scheduled-tasks/api';
export * from '../features/workflows/api';
export * from './api/mcp-servers';
export * from './api/workspace-skills';
export * from './api/gateway';
export * from './api/notifications';
export * from './api/files';
export * from './api/commands';
