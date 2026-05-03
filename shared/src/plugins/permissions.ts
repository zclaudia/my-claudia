export type Permission =
  // 安全级别
  | 'session.read'
  | 'project.read'
  | 'storage'
  // 中等级别
  | 'fs.read'
  | 'network.fetch'
  | 'timer'
  | 'provider.call'
  // 敏感级别
  | 'fs.write'
  | 'session.write'
  | 'notification'
  | 'clipboard.read'
  | 'clipboard.write'
  // 危险级别
  | 'shell.execute';
