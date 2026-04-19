import os from 'os';

interface SqliteLikeDb {
  prepare?: (sql: string) => {
    get: (...args: unknown[]) => Record<string, unknown> | undefined;
  };
}

function safeGetRow(
  db: SqliteLikeDb | null | undefined,
  sql: string,
  ...params: unknown[]
): Record<string, unknown> | undefined {
  if (!db || typeof db.prepare !== 'function') return undefined;
  try {
    return db.prepare(sql).get(...params);
  } catch {
    return undefined;
  }
}

export function getBackendDisplayName(db?: SqliteLikeDb | null): string {
  const row = safeGetRow(
    db,
    `SELECT backend_name as backendName
     FROM gateway_config
     WHERE id = 1`
  );
  const backendName = typeof row?.backendName === 'string' ? row.backendName.trim() : '';
  if (backendName) return backendName;

  const envName = typeof process.env.GATEWAY_NAME === 'string' ? process.env.GATEWAY_NAME.trim() : '';
  if (envName) return envName;

  return `Backend on ${os.hostname()}`;
}

export function getSessionDisplayName(db: SqliteLikeDb | null | undefined, sessionId: string): string {
  const row = safeGetRow(
    db,
    `SELECT name
     FROM sessions
     WHERE id = ?`,
    sessionId,
  );
  const sessionName = typeof row?.name === 'string' ? row.name.trim() : '';
  return sessionName || sessionId;
}

export function formatSessionBackendContext(db: SqliteLikeDb | null | undefined, sessionId: string): string {
  const sessionName = getSessionDisplayName(db, sessionId);
  const backendName = getBackendDisplayName(db);
  return `Session ${sessionName} on backend ${backendName}`;
}

export function getBackendRouteId(db?: SqliteLikeDb | null): string | null {
  const row = safeGetRow(
    db,
    `SELECT backend_id as backendId
     FROM gateway_config
     WHERE id = 1`
  );
  const backendId = typeof row?.backendId === 'string' ? row.backendId.trim() : '';
  return backendId || null;
}

export function buildAppSelectionClickUrl(
  db: SqliteLikeDb | null | undefined,
  target: { sessionId?: string; projectId?: string; backendId?: string | null },
): string | undefined {
  const baseUrl = (process.env.MY_CLAUDIA_APP_URL || process.env.PUBLIC_APP_URL || '').trim();
  if (!baseUrl) return undefined;

  try {
    const url = new URL(baseUrl);
    const backendId = target.backendId ?? getBackendRouteId(db);
    if (backendId) url.searchParams.set('backendId', backendId);
    if (target.projectId) url.searchParams.set('projectId', target.projectId);
    if (target.sessionId) url.searchParams.set('sessionId', target.sessionId);
    return url.toString();
  } catch {
    return undefined;
  }
}
