import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseTscDiagnostics, readBuildErrorsForFile } from '../../src/kernel/telemetry/buildDiagnostics';
import { HeadlessDiagnosticsService } from '../../src/adapters/node/HeadlessDiagnosticsService';

const TS_OUTPUT = [
  "src/features/document-parser/services/resume-builder-service.ts(3,29): error TS2307: Cannot find module '../../../../infrastructure/ai/parser-service-config'.",
  "src/features/document-parser/services/resume-enrichment-service.ts(4,23): error TS2307: Cannot find module '../../../../infrastructure/ai/base-ai-service'.",
].join('\n');

describe('parseTscDiagnostics', () => {
  it('parses the standard tsc diagnostic format', () => {
    const entries = parseTscDiagnostics(TS_OUTPUT);
    expect(entries).toEqual([
      {
        file: 'src/features/document-parser/services/resume-builder-service.ts',
        line: 3,
        message: "Cannot find module '../../../../infrastructure/ai/parser-service-config'.",
      },
      {
        file: 'src/features/document-parser/services/resume-enrichment-service.ts',
        line: 4,
        message: "Cannot find module '../../../../infrastructure/ai/base-ai-service'.",
      },
    ]);
  });

  it('returns no entries for clean output', () => {
    expect(parseTscDiagnostics('')).toEqual([]);
    expect(parseTscDiagnostics('Build succeeded.')).toEqual([]);
  });
});

describe('readBuildErrorsForFile', () => {
  let workspace: string;

  afterEach(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  function writeDiagnosticsFile(savedAt: string, output = TS_OUTPUT): void {
    const dir = join(workspace, '.mitii', 'diagnostics');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'current-build-errors.json'),
      JSON.stringify({ savedAt, command: 'pnpm run build', exitCode: 2, output })
    );
  }

  it('returns errors touching the requested file from a fresh dump', () => {
    workspace = mkdtempSync(join(tmpdir(), 'mitii-build-diag-'));
    writeDiagnosticsFile(new Date().toISOString());

    const errors = readBuildErrorsForFile(
      workspace,
      'src/features/document-parser/services/resume-builder-service.ts'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('parser-service-config');
  });

  it('returns no errors for a file not mentioned in the dump', () => {
    workspace = mkdtempSync(join(tmpdir(), 'mitii-build-diag-'));
    writeDiagnosticsFile(new Date().toISOString());

    expect(readBuildErrorsForFile(workspace, 'src/unrelated-file.ts')).toEqual([]);
  });

  it('ignores a stale dump instead of trusting it as current evidence', () => {
    workspace = mkdtempSync(join(tmpdir(), 'mitii-build-diag-'));
    const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    writeDiagnosticsFile(staleTimestamp);

    const errors = readBuildErrorsForFile(
      workspace,
      'src/features/document-parser/services/resume-builder-service.ts',
      5 * 60 * 1000
    );
    expect(errors).toEqual([]);
  });

  it('returns no errors when no dump exists', () => {
    workspace = mkdtempSync(join(tmpdir(), 'mitii-build-diag-'));
    expect(readBuildErrorsForFile(workspace, 'src/index.ts')).toEqual([]);
  });
});

describe('HeadlessDiagnosticsService', () => {
  let workspace: string;

  afterEach(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  it('reports [] before setWorkspaceRoot and before any diagnostics dump exists', async () => {
    const service = new HeadlessDiagnosticsService();
    expect(service.getFileErrors('src/index.ts')).toEqual([]);
    expect(await service.waitForFileErrors('src/index.ts')).toEqual([]);
  });

  it('surfaces post-edit build errors from a fresh diagnostics dump once the workspace root is set', async () => {
    workspace = mkdtempSync(join(tmpdir(), 'mitii-headless-diag-'));
    const dir = join(workspace, '.mitii', 'diagnostics');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'current-build-errors.json'),
      JSON.stringify({ savedAt: new Date().toISOString(), command: 'pnpm run build', exitCode: 2, output: TS_OUTPUT })
    );

    const service = new HeadlessDiagnosticsService();
    service.setWorkspaceRoot(workspace);
    const errors = await service.waitForFileErrors(
      'src/features/document-parser/services/resume-enrichment-service.ts'
    );
    expect(errors).toEqual([{ line: 4, message: "Cannot find module '../../../../infrastructure/ai/base-ai-service'." }]);
  });
});
