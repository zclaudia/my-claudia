import { describe, expect, it } from 'vitest';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  buildAppSelectionClickUrl,
  formatSessionBackendContext,
  getBackendDisplayName,
  getSessionDisplayName,
} from '../notification-context.js';

describe('notification-context', () => {
  const previousAppUrl = process.env.MY_CLAUDIA_APP_URL;

  beforeEach(() => {
    process.env.MY_CLAUDIA_APP_URL = 'myclaudia://open';
  });

  afterEach(() => {
    if (previousAppUrl === undefined) {
      delete process.env.MY_CLAUDIA_APP_URL;
      return;
    }
    process.env.MY_CLAUDIA_APP_URL = previousAppUrl;
  });

  it('formats session and backend names from database rows', () => {
    const db = {
      prepare: (sql: string) => ({
        get: (...args: unknown[]) => {
          if (sql.includes('FROM gateway_config')) {
            if (sql.includes('backend_id')) {
              return { backendId: 'backend-123' };
            }
            return { backendName: 'Office Mac Mini' };
          }
          if (sql.includes('FROM sessions')) {
            expect(args[0]).toBe('sess-1');
            return { name: 'Release Train' };
          }
          return undefined;
        },
      }),
    };

    expect(getBackendDisplayName(db)).toBe('Office Mac Mini');
    expect(getSessionDisplayName(db, 'sess-1')).toBe('Release Train');
    expect(formatSessionBackendContext(db, 'sess-1')).toBe('Session Release Train on backend Office Mac Mini');
    expect(buildAppSelectionClickUrl(db, { sessionId: 'sess-1' })).toBe('myclaudia://open?backendId=backend-123&sessionId=sess-1');
  });

  it('falls back to ids and environment-safe defaults when db data is unavailable', () => {
    const db = {
      prepare: () => ({
        get: () => undefined,
      }),
    };

    expect(getSessionDisplayName(db, 'sess-404')).toBe('sess-404');
    expect(formatSessionBackendContext(db, 'sess-404')).toContain('Session sess-404 on backend ');
  });
});
