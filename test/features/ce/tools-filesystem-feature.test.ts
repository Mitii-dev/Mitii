import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRuntime } from '../../../src/kernel/bootstrap';
import { ceFeatureModules } from '../../../src/features/ce/featureModules';
import { IgnoreService } from '../../../src/features/ce/indexing/IgnoreService';
import type { CeSessionServices } from '../../../src/features/ce/tools/sessionServices';

/**
 * Proves the `ToolFactoryContribution` pattern end to end for the filesystem-tools feature:
 * the same real `createReadFileTool`/`createWriteFileTool`/etc. implementations `ThunderController`
 * hand-wires today, but reached through `FeatureModule.register()` -> `ToolRegistry` -> `.create(session)`.
 * Not yet wired into `ThunderController`/`HeadlessAgentHost` themselves (see migration plan doc).
 */
describe('ce.tools.filesystem feature module', () => {
  let workspace: string;
  let services: CeSessionServices;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'mitii-fs-tools-'));
    const ignoreService = new IgnoreService();
    ignoreService.load(workspace);
    services = { workspace, extensionRoot: workspace, ignoreService };
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('registers exactly the expected tool ids, owned by ce.tools.filesystem', () => {
    const runtime = buildRuntime({
      features: ceFeatureModules,
      hostPorts: { workspace: { workspaceRoot: workspace, readText: async () => '', writeText: async () => {} } },
    });

    const ids = runtime.registries.tools
      .list()
      .filter((f) => f.owner === 'ce.tools.filesystem')
      .map((f) => f.id)
      .sort();

    expect(ids).toEqual([
      'apply_patch',
      'execute_workspace_script',
      'list_files',
      'read_file',
      'read_files',
      'resolve_path',
      'search',
      'search_batch',
      'search_script_catalog',
      'write_file',
    ]);
  });

  it('resolved tools actually read and write real files through the session-bound services', async () => {
    writeFileSync(join(workspace, 'hello.txt'), 'hello world');

    const runtime = buildRuntime({
      features: ceFeatureModules,
      hostPorts: { workspace: { workspaceRoot: workspace, readText: async () => '', writeText: async () => {} } },
    });

    const readFileFactory = runtime.registries.tools.get('read_file');
    expect(readFileFactory).toBeDefined();
    const readFileTool = readFileFactory!.create(services);
    const readResult = await readFileTool.execute({ path: 'hello.txt' });
    expect(readResult.success).toBe(true);
    expect(readResult.output).toContain('hello world');

    const writeFileFactory = runtime.registries.tools.get('write_file');
    const writeFileTool = writeFileFactory!.create(services);
    const writeResult = await writeFileTool.execute({ path: 'new.txt', content: 'new content' });
    expect(writeResult.success).toBe(true);

    const readNewFileTool = readFileFactory!.create(services);
    const readNewResult = await readNewFileTool.execute({ path: 'new.txt' });
    expect(readNewResult.output).toContain('new content');
  });
});
