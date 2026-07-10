import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ThunderDb } from '../src/core/indexing/ThunderDb';
import { MigrationRunner } from '../src/core/indexing/migrations';
import { WorkspaceLanguageService } from '../src/core/indexing/WorkspaceLanguageService';
import { IgnoreService } from '../src/core/indexing/IgnoreService';
import { defaultThunderConfig } from '../src/core/config/defaults';
import { CallGraphContextSource } from '../src/core/context/sources/callGraphSource';

describe('CallGraphContextSource', () => {
  let dir: string;
  let db: ThunderDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mitii-call-graph-'));
    writeFileSync(
      join(dir, 'impl.ts'),
      `export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n`
    );
    writeFileSync(
      join(dir, 'usage.ts'),
      `import { verifyToken } from './impl';\n\nexport function handler(token: string) {\n  return verifyToken(token);\n}\n`
    );

    db = new ThunderDb(join(dir, 'test.sqlite'));
    db.open();
    new MigrationRunner(db).run();

    const insertFile = db.raw.prepare(
      `INSERT INTO files (workspace, path, rel_path, hash, size, mtime, language, indexed_at)
       VALUES (?, ?, ?, 'hash', 0, 0, 'typescript', ?)`
    );
    const implFileId = insertFile.run(dir, join(dir, 'impl.ts'), 'impl.ts', Date.now()).lastInsertRowid;
    insertFile.run(dir, join(dir, 'usage.ts'), 'usage.ts', Date.now());

    db.raw
      .prepare(`INSERT INTO symbols (file_id, name, kind, signature, start_line, end_line) VALUES (?, ?, 'function', ?, 1, 3)`)
      .run(implFileId, 'verifyToken', 'export function verifyToken(token: string): boolean');
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the true definition and real callers for a symbol mentioned in the query', async () => {
    const ignoreService = new IgnoreService();
    ignoreService.load(dir, {});
    const languageService = new WorkspaceLanguageService(dir, ignoreService, defaultThunderConfig().indexing);
    const source = new CallGraphContextSource(db, dir, languageService);

    const items = await source.retrieve({ text: 'what calls verifyToken?', maxItems: 30 });

    expect(items.length).toBe(2);
    const defItem = items.find((i) => i.reason.includes('true definition'));
    const callersItem = items.find((i) => i.reason.includes('callers'));

    expect(defItem?.relPath).toBe('impl.ts');
    expect(callersItem?.content).toContain('usage.ts');
    expect(callersItem?.content).toContain('handler');
  });

  it('never throws and returns an empty list when nothing matches', async () => {
    const ignoreService = new IgnoreService();
    ignoreService.load(dir, {});
    const languageService = new WorkspaceLanguageService(dir, ignoreService, defaultThunderConfig().indexing);
    const source = new CallGraphContextSource(db, dir, languageService);

    const items = await source.retrieve({ text: 'nothing relevant here', maxItems: 30 });
    expect(items).toEqual([]);
  });
});
