/**
 * SQLite injection contract.
 *
 * Hosts supply `openDatabase` so Electron-native bindings stay in VS Code
 * while the CLI uses better-sqlite3. Indexing and repository-context require it.
 */
export type {
  HostSqliteDatabase,
  HostSqliteOpenOptions,
  OpenHostSqliteDatabase,
} from '../sqlite/types.js';
