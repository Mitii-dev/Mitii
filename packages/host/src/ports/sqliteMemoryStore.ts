import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { memoryFactSchema, MemoryContentPolicy, type MemoryFact, type MemoryScope,
  type MemoryFactDraft, type MemoryStorePort } from '@mitii/v8';
import type { OpenHostSqliteDatabase } from '../sqlite/types.js';
import { atomicMemoryWrite, withMemoryFileLock } from './memoryFileIO.js';
import { MemoryStorageError } from './memoryStoreErrors.js';

interface Statement {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): unknown;
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

let databaseOpener: OpenHostSqliteDatabase | undefined;
/** Application composition supplies native bindings once per process. */
export function configureMemoryDatabase(open: OpenHostSqliteDatabase): void { databaseOpener = open; }
export function memoryDatabaseOpener(): OpenHostSqliteDatabase | undefined { return databaseOpener; }

const sameScope = (a: MemoryScope, b: MemoryScope) => a.kind === b.kind &&
  (a.kind === 'workspace' ? a.workspaceId === b.workspaceId : a.kind === 'project' ? a.projectId === b.projectId : a.userId === b.userId);

/** Canonical SQLite facts with atomic decisions, audit and a guarded read-only
 * JSON projection for the standalone memory search process. */
export class SqliteWorkspaceMemoryStore implements MemoryStorePort {
  private readonly root: string;
  private readonly path: string;
  private readonly projection: string;
  private readonly ready: Promise<void>;

  constructor(workspaceRoot: string, private readonly workspaceId: string, private readonly open: OpenHostSqliteDatabase) {
    this.root = join(workspaceRoot, '.mitii', 'memory');
    this.path = join(this.root, 'memory.sqlite');
    this.projection = join(this.root, 'facts.json');
    mkdirSync(this.root, { recursive: true });
    this.ready = this.initialize();
    // Retain the rejection for public operations without an unhandled rejection.
    void this.ready.catch(() => undefined);
  }

  private connection(): Database {
    const db = this.open(this.path) as unknown as Database;
    try {
      db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
      if (row.user_version > 1) throw new MemoryStorageError('memory_storage_version_unsupported');
      db.exec(`CREATE TABLE IF NOT EXISTS memory_facts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS memory_audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, ids TEXT NOT NULL);
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, content);
        PRAGMA user_version=1;`);
      return db;
    } catch (error) { db.close(); throw error; }
  }

  private rows(db: Database): MemoryFact[] {
    return db.prepare('SELECT body FROM memory_facts ORDER BY rowid').all()
      .map(row => memoryFactSchema.parse(JSON.parse((row as { body: string }).body)));
  }

  private async initialize(): Promise<void> {
    await withMemoryFileLock(this.projection, async () => {
      const db = this.connection();
      try {
        if (!db.prepare("SELECT value FROM memory_meta WHERE key='imported'").get()) {
          let imported: MemoryFact[] = [];
          let original: string | undefined;
          try { original = await readFile(this.projection, 'utf8'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          if (original !== undefined) {
            const parsed = z.object({ storageVersion: z.union([z.literal(1), z.literal(2)]),
              facts: z.array(z.unknown()), generation: z.string().optional() }).strict().safeParse(JSON.parse(original));
            if (!parsed.success) throw new MemoryStorageError('memory_storage_recovery_required');
            imported = parsed.data.facts.map(raw => {
              if (!raw || typeof raw !== 'object') throw new MemoryStorageError('memory_storage_recovery_required');
              return memoryFactSchema.parse({ scope: { kind: 'workspace', workspaceId: this.workspaceId }, privacy: 'shareable', ...raw });
            });
            if (new Set(imported.map(row => row.id)).size !== imported.length) throw new MemoryStorageError('memory_storage_recovery_required');
            await atomicMemoryWrite(join(this.root, 'facts.pre-sqlite.json'), original);
          }
          db.exec('BEGIN IMMEDIATE');
          try {
            for (const row of imported) this.upsert(db, row);
            db.prepare("INSERT INTO memory_meta(key,value) VALUES('imported','1')").run();
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
        }
        await this.publish(db);
      } finally { db.close(); }
    });
  }

  private upsert(db: Database, input: MemoryFact): void {
    const fact = new MemoryContentPolicy().fact(input);
    db.prepare('INSERT INTO memory_facts(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(fact.id, JSON.stringify(fact));
    db.prepare('DELETE FROM memory_fts WHERE id=?').run(fact.id);
    db.prepare('INSERT INTO memory_fts(id,content) VALUES(?,?)').run(fact.id,
      [fact.title, fact.content, ...fact.concepts, ...fact.files].filter(Boolean).join(' '));
  }

  private async publish(db: Database, generation = randomUUID()): Promise<void> {
    // Invalidate before publication. Readers check the manifest twice.
    await atomicMemoryWrite(join(this.root, 'projection.json'), JSON.stringify({ generation }));
    await atomicMemoryWrite(this.projection, JSON.stringify({ storageVersion: 2, generation, facts: this.rows(db) }));
  }

  public async list(scope?: MemoryScope): Promise<readonly MemoryFact[]> {
    await this.ready;
    const db = this.connection();
    try { return this.rows(db).filter(row => !scope || sameScope(row.scope, scope)); }
    finally { db.close(); }
  }

  public async query(input: { scope: MemoryScope; query: string }): Promise<readonly MemoryFact[]> {
    return this.list(input.scope);
  }

  public async transact<T>(scope: MemoryScope, decide: (facts: readonly MemoryFact[]) => {
    facts: readonly MemoryFact[]; result: T;
  }): Promise<T> {
    return this.mutate('commit', db => {
      const rows = this.rows(db);
      const decision = decide(rows.filter(row => sameScope(row.scope, scope)));
      const changed = memoryFactSchema.array().parse(decision.facts);
      if (changed.some(row => !sameScope(row.scope, scope) || rows.some(old => old.id === row.id && !sameScope(old.scope, scope))))
        throw new Error('Memory transaction scope mismatch.');
      if (new Set(changed.map(row => row.id)).size !== changed.length) throw new Error('Duplicate transaction IDs.');
      changed.forEach(row => this.upsert(db, row));
      return { result: decision.result, ids: changed.map(row => row.id) };
    });
  }

  private async mutate<T>(action: string, decide: (db: Database) => { result: T; ids: string[] }): Promise<T> {
    await this.ready;
    return withMemoryFileLock(this.projection, async () => {
      const db = this.connection();
      const generation = randomUUID();
      try {
        await atomicMemoryWrite(join(this.root, 'projection.json'), JSON.stringify({ generation }));
        db.exec('BEGIN IMMEDIATE');
        let decision: { result: T; ids: string[] };
        try {
          decision = decide(db);
          if (decision.ids.length) db.prepare('INSERT INTO memory_audit(at,action,ids) VALUES(?,?,?)')
            .run(new Date().toISOString(), action, JSON.stringify(decision.ids));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        await this.publish(db, generation);
        return decision.result;
      } finally { db.close(); }
    });
  }

  public async commit(input: MemoryFactDraft): Promise<void> {
    const fact = memoryFactSchema.parse(input);
    await this.transact(fact.scope, () => ({ facts: [fact], result: undefined }));
  }

  public async recordAccess(ids: readonly string[], at: string): Promise<void> {
    z.string().datetime().parse(at);
    if (!ids.length) return;
    await this.mutate('access', db => {
      const changed = this.rows(db).filter(row => ids.includes(row.id));
      changed.forEach(row => this.upsert(db, { ...row, accessCount: row.accessCount + 1,
        lastAccessedAt: at, accessLog: [...row.accessLog, at].slice(-20) }));
      return { result: undefined, ids: changed.map(row => row.id) };
    });
  }

  public async delete(id: string, reason = 'user_delete') {
    return this.mutate(reason, db => {
      const exists = Boolean(db.prepare('SELECT id FROM memory_facts WHERE id=?').get(id));
      db.prepare('DELETE FROM memory_facts WHERE id=?').run(id);
      db.prepare('DELETE FROM memory_fts WHERE id=?').run(id);
      return { ids: exists ? [id] : [], result: { id, deleted: exists,
        message: exists ? `Deleted memory id "${id}".` : `Memory id "${id}" not found.` } };
    });
  }
}
