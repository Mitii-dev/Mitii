import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createHostLanguageServices } from './createHostLanguageServices.js';

describe('createHostLanguageServices', () => {
  it('degrades to the repo graph when no tsconfig is present', () => {
    return withWorkspace(async (workspaceRoot) => {
      const services = createHostLanguageServices({ workspaceRoot });
      expect(services.capability.status).toBe('degraded');
      expect(services.capability.reason).toBe('language_server_not_configured');
      expect(services.diagnostics).toBeUndefined();
      services.dispose();
    });
  });

  it('attaches a TypeScript language service and surfaces post-edit diagnostics', () => {
    return withWorkspace(async (workspaceRoot) => {
      await writeFile(
        join(workspaceRoot, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            noEmit: true,
            skipLibCheck: true,
          },
          include: ['src'],
        }),
      );
      await writeFile(
        join(workspaceRoot, 'src/greet.ts'),
        'export function greet(name: string) {\n  return name;\n}\nconst broken: number = "x";\n',
      );

      const services = createHostLanguageServices({ workspaceRoot });
      try {
        expect(services.capability.status).toBe('available');
        expect(services.capability.reason).toBe('typescript_language_service');
        const symbols = await services.codeNavigation.documentSymbols?.({
          relativePath: 'src/greet.ts',
        });
        expect(symbols?.some((item) => item.symbolName === 'greet')).toBe(true);
        const diagnostics = await services.diagnostics?.readDiagnostics({
          workspaceRoot,
          paths: ['src/greet.ts'],
        });
        expect(diagnostics?.some((item) => item.severity === 'error')).toBe(true);
      } finally {
        services.dispose();
      }
    });
  });

  it('resolves implementations and call hierarchy from the TypeScript service', () => {
    return withWorkspace(async (workspaceRoot) => {
      await writeFile(
        join(workspaceRoot, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            noEmit: true,
            skipLibCheck: true,
          },
          include: ['src'],
        }),
      );
      await writeFile(
        join(workspaceRoot, 'src/port.ts'),
        'export interface Port {\n  run(): void;\n}\n',
      );
      await writeFile(
        join(workspaceRoot, 'src/child.ts'),
        [
          'import type { Port } from "./port";',
          'export class Child implements Port {',
          '  run(): void {}',
          '}',
          'export function entry() {',
          '  new Child().run();',
          '}',
          '',
        ].join('\n'),
      );

      const services = createHostLanguageServices({ workspaceRoot });
      try {
        const implementations = await services.codeNavigation.implementation?.({
          relativePath: 'src/port.ts',
          line: 1,
          column: 18,
        });
        expect(implementations?.some((item) => item.symbolName === 'Child' || item.relativePath.endsWith('child.ts'))).toBe(
          true,
        );

        const callees = await services.codeNavigation.callHierarchy?.({
          relativePath: 'src/child.ts',
          line: 5,
          column: 17,
          direction: 'outgoing',
        });
        expect(callees?.some((item) => item.symbolName === 'run' || item.symbolName === 'Child')).toBe(
          true,
        );
      } finally {
        services.dispose();
      }
    });
  });
  it('does not attach a parent-directory tsconfig outside the workspace', async () => {
    const { mkdir, writeFile: write, rm } = await import('node:fs/promises');
    const parent = await mkdtemp(join(tmpdir(), 'mitii-parent-ts-'));
    const workspaceRoot = join(parent, 'fixture-workspace');
    try {
      await write(
        join(parent, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { strict: true, noEmit: true },
          include: ['src'],
        }),
      );
      await mkdir(join(parent, 'src'), { recursive: true });
      await write(join(parent, 'src/root.ts'), 'export const x = 1;\n');
      await mkdir(workspaceRoot, { recursive: true });
      await mkdir(join(workspaceRoot, 'src'), { recursive: true });
      await write(
        join(workspaceRoot, 'src/App.tsx'),
        'export default function App() { return null; }\n',
      );

      const services = createHostLanguageServices({ workspaceRoot });
      try {
        expect(services.capability.status).toBe('degraded');
        expect(services.diagnostics).toBeUndefined();
      } finally {
        services.dispose();
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('skips missing paths and does not throw (apply_patch create baseline)', () => {
    return withWorkspace(async (workspaceRoot) => {
      await writeFile(
        join(workspaceRoot, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            noEmit: true,
            skipLibCheck: true,
          },
          include: ['src', 'app'],
        }),
      );
      await writeFile(
        join(workspaceRoot, 'src/greet.ts'),
        'export function greet(name: string) {\n  return name;\n}\n',
      );

      const services = createHostLanguageServices({ workspaceRoot });
      try {
        const missing = await services.diagnostics?.readDiagnostics({
          workspaceRoot,
          paths: ['app/about/page.tsx'],
        });
        expect(missing).toEqual([]);

        const { mkdir } = await import('node:fs/promises');
        await mkdir(join(workspaceRoot, 'app/about'), { recursive: true });
        await writeFile(
          join(workspaceRoot, 'app/about/page.tsx'),
          'export default function About() {\n  return "About this benchmark app";\n}\n',
        );
        const afterCreate = await services.diagnostics?.readDiagnostics({
          workspaceRoot,
          paths: ['app/about/page.tsx'],
        });
        expect(Array.isArray(afterCreate)).toBe(true);
      } finally {
        services.dispose();
      }
    });
  });
});

async function withWorkspace(
  run: (workspaceRoot: string) => Promise<void>,
): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'mitii-lang-'));
  await mkdir(join(workspaceRoot, 'src'), { recursive: true });
  try {
    await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}
