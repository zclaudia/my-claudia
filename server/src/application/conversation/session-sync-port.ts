export interface SessionSyncPort {
  broadcastSessionUpdated(sessionId: string, db: {
    prepare: (sql: string) => {
      get: (id: string) => {
        id: string;
        name?: string;
        updatedAt?: number;
        archivedAt?: number | null;
      } | undefined;
    };
  }): void;
}
