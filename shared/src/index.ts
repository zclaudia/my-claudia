// Shared types for MyClaudia
// This file re-exports all types from sub-modules for backward compatibility.
// Consumers should prefer sub-path imports (e.g. '@my-claudia/shared/core/session').
//
// ── Direction (see docs/architecture/context-map.md) ──────────────────
//
//   shared-kernel:          Core domain types used across all contexts
//     core/*, features/*, interaction/*, files, plugin-types
//
//   integration-protocol:   Client-server wire protocol & gateway relay
//     protocol/correlation, protocol/messages, protocol/gateway
//
//   ui-facade:              Frontend-only facade runtime & types
//     facade/*
//
// No physical split required yet — sub-path imports already enforce boundaries.
// ──────────────────────────────────────────────────────────────────────

// ── shared-kernel ────────────────────────────────────────────────────

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
export * from './features/local-issue.js';
export * from './features/system-tasks.js';
export * from './features/workflows.js';
export * from './features/notification-feed.js';
/** @deprecated Use AIReviewConfig in UnifiedPermissionPolicy instead. */
export * from './features/delegation.js';

// Interaction types
export * from './interaction/permissions.js';
export * from './interaction/forms.js';
export * from './interaction/notifications.js';

// File browser types
export * from './files.js';

// Plugin types
export * from './plugin-types.js';

// ── integration-protocol ─────────────────────────────────────────────

export * from './protocol/correlation.js';
export * from './protocol/messages.js';
export * from './protocol/gateway.js';

// ── ui-facade ────────────────────────────────────────────────────────

export * from './facade/index.js';
