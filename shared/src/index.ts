// Shared types for MyClaudia
// This file re-exports all types from sub-modules for backward compatibility.
// Consumers can continue importing from '@my-claudia/shared' without changes.

// Core types
export * from './core/server.js';
export * from './core/provider.js';
export * from './core/session.js';
export * from './core/message.js';
export * from './core/project.js';
export * from './core/api.js';
export * from './core/mcp.js';
export * from './core/pcp.js';

// Feature types
export * from './features/commands.js';
export * from './features/supervision.js';
export * from './features/local-pr.js';
export * from './features/scheduled-tasks.js';
export * from './features/system-tasks.js';
export * from './features/workflows.js';
export * from './features/notification-feed.js';
export * from './features/agent-triggers.js';
export * from './features/delegation.js';
export * from './features/local-reviewer.js';

// Interaction types
export * from './interaction/permissions.js';
export * from './interaction/forms.js';
export * from './interaction/notifications.js';

// Protocol types
export * from './protocol/correlation.js';
export * from './protocol/messages.js';
export * from './protocol/gateway.js';

// File browser types
export * from './files.js';

// Plugin types
export * from './plugin-types.js';

// Facade types and runtime
export * from './facade/index.js';
