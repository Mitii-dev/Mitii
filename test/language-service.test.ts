import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WorkspaceLanguageService } from '../src/core/indexing/WorkspaceLanguageService';
import { IgnoreService } from '../src/core/indexing/IgnoreService';
import { defaultThunderConfig } from '../src/core/config/defaults';

function makeWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mitii-lang-service-'));
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(dir, relPath);
    mkdirSync(join(absPath, '..'), { recursive: true });
    writeFileSync(absPath, content, 'utf-8');
  }
  return dir;
}

function makeService(dir: string): WorkspaceLanguageService {
  const ignoreService = new IgnoreService();
  ignoreService.load(dir, {});
  return new WorkspaceLanguageService(dir, ignoreService, defaultThunderConfig().indexing);
}

describe('WorkspaceLanguageService', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a cross-file function definition (no tsconfig, manual discovery)', () => {
    dir = makeWorkspace({
      'impl.ts': `export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n`,
      'usage.ts': `import { verifyToken } from './impl';\n\nexport function handler(token: string) {\n  return verifyToken(token);\n}\n`,
    });
    const service = makeService(dir);

    const column = service.findColumnForName('usage.ts', 4, 'verifyToken');
    expect(column).toBeDefined();

    const definitions = service.getDefinition('usage.ts', 4, column!);
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions[0].relPath).toBe('impl.ts');
    expect(definitions[0].startLine).toBe(1);
  });

  it('resolves through a re-export barrel to the true declaration', () => {
    dir = makeWorkspace({
      'impl.ts': `export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n`,
      'index.ts': `export { verifyToken } from './impl';\n`,
      'usage.ts': `import { verifyToken } from './index';\n\nexport function handler(token: string) {\n  return verifyToken(token);\n}\n`,
    });
    const service = makeService(dir);

    const column = service.findColumnForName('usage.ts', 4, 'verifyToken');
    const definitions = service.getDefinition('usage.ts', 4, column!);

    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions[0].relPath).toBe('impl.ts');
  });

  it('getCallers only returns real call sites, not imports or type references', () => {
    dir = makeWorkspace({
      'impl.ts': `export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n`,
      'usage.ts':
        `import { verifyToken } from './impl';\n\n` +
        `type Verifier = typeof verifyToken;\n\n` +
        `export function handlerA(token: string) {\n  return verifyToken(token);\n}\n\n` +
        `export function handlerB(token: string) {\n  return verifyToken(token);\n}\n`,
    });
    const service = makeService(dir);

    const column = service.findColumnForName('impl.ts', 1, 'verifyToken');
    const callers = service.getCallers('impl.ts', 1, column!);

    expect(callers.length).toBe(2);
    expect(callers.every((c) => c.relPath === 'usage.ts')).toBe(true);
    expect(callers.map((c) => c.enclosingSymbol).sort()).toEqual(['handlerA', 'handlerB']);
  });

  it('reflects unsaved editor content via updateFile before a subsequent getDefinition', () => {
    dir = makeWorkspace({
      'impl.ts': `export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n`,
      'usage.ts': `import { verifyToken } from './impl';\n\nexport function handler(token: string) {\n  return verifyToken(token);\n}\n`,
    });
    const service = makeService(dir);

    // Force initialization, then simulate an unsaved edit that adds a second caller.
    service.getDefinition('usage.ts', 4, 6);
    service.updateFile(
      'usage.ts',
      `import { verifyToken } from './impl';\n\n` +
        `export function handler(token: string) {\n  return verifyToken(token);\n}\n\n` +
        `export function handlerB(token: string) {\n  return verifyToken(token);\n}\n`
    );

    const column = service.findColumnForName('impl.ts', 1, 'verifyToken');
    const callers = service.getCallers('impl.ts', 1, column!);
    expect(callers.length).toBe(2);
  });
});
