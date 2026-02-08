import type { BackendServer } from '@my-claudia/shared';

/**
 * One-time migration utility to transfer server configurations
 * from localStorage to database
 */
export async function migrateServersFromLocalStorage(
  addServer: (server: Omit<BackendServer, 'id' | 'createdAt' | 'lastConnected'>) => void
): Promise<number> {
  const OLD_STORAGE_KEY = 'my-claudia-servers';

  try {
    const oldData = localStorage.getItem(OLD_STORAGE_KEY);
    if (!oldData) {
      console.log('[Migration] No old server data found in localStorage');
      return 0;
    }

    const parsed = JSON.parse(oldData);
    const oldServers = parsed?.state?.servers as BackendServer[] | undefined;

    if (!oldServers || oldServers.length === 0) {
      console.log('[Migration] No servers to migrate');
      return 0;
    }

    console.log(`[Migration] Found ${oldServers.length} servers in localStorage`);

    // Filter out the default 'local' server (already in DB)
    const serversToMigrate = oldServers.filter(s => s.id !== 'local');

    if (serversToMigrate.length === 0) {
      console.log('[Migration] Only default server found, nothing to migrate');
      // Clean up old storage
      localStorage.removeItem(OLD_STORAGE_KEY);
      return 0;
    }

    console.log(`[Migration] Migrating ${serversToMigrate.length} servers to database...`);

    // Migrate each server
    for (const server of serversToMigrate) {
      const { id, createdAt, lastConnected, ...serverData } = server;

      // Ensure required fields exist
      const validatedData = {
        ...serverData,
        name: serverData.name || server.address || 'Unnamed Server',
        address: serverData.address || 'localhost:3100',
        isDefault: serverData.isDefault || false
      };

      addServer(validatedData);
      console.log(`[Migration] Migrated server: ${validatedData.name}`);
    }

    // Clean up old storage after successful migration
    localStorage.removeItem(OLD_STORAGE_KEY);
    console.log('[Migration] Migration complete, old storage cleaned up');

    return serversToMigrate.length;
  } catch (error) {
    console.error('[Migration] Failed to migrate servers:', error);
    return 0;
  }
}

/**
 * Check if migration is needed
 */
export function needsMigration(): boolean {
  const OLD_STORAGE_KEY = 'my-claudia-servers';
  const oldData = localStorage.getItem(OLD_STORAGE_KEY);

  if (!oldData) return false;

  try {
    const parsed = JSON.parse(oldData);
    const oldServers = parsed?.state?.servers as BackendServer[] | undefined;
    const serversToMigrate = oldServers?.filter(s => s.id !== 'local') || [];
    return serversToMigrate.length > 0;
  } catch {
    return false;
  }
}
