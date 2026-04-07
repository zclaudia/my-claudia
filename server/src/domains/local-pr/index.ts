// Local PR Domain
//
// This domain encapsulates the local PR feature including:
// - Domain registration (routes, service, events, scheduler)
// - Routes for PR management API
// - Service for PR business logic
// - Repository for data access

export { registerLocalPRDomain } from './register.js';
export type { LocalPRDomainDeps, LocalPRDomainResult } from './register.js';
export { createLocalPRRoutes } from './routes.js';
export { LocalPRService } from './service.js';
export { LocalPRRepository } from './repository.js';
export type { LocalPRAiSessionPort, LocalPRSchedulingPort } from './ports.js';
