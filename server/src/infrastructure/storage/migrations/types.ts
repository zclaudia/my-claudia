export interface Migration {
  name: string;
  sql: string;
  /** If true, duplicate column errors are tolerated (migration may have been partially applied). */
  idempotent?: boolean;
}
