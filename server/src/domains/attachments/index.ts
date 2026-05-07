export { registerAttachmentDomain } from './register.js';
export type { AttachmentDomainDeps, AttachmentDomainResult } from './register.js';
export { createAttachmentRoutes } from './routes.js';
export { AttachmentService, toAttachment } from './service.js';
export { AttachmentRepository } from './repository.js';
export type { AttachmentRow } from './repository.js';
export { detectKindFromMime, isValidOwnerKind } from './kind-detector.js';
export { registerOwnerGuard, checkOwnerAccess } from './access-control.js';
