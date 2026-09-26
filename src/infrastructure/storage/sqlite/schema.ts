// Ordered schema migrations; openDatabase applies them against PRAGMA user_version.
export interface Migration {
  readonly version: number;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [];
