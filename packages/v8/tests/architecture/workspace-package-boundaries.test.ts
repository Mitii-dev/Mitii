import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { repoRoot, scanImports } from './support/v8Sources';

describe('workspace package boundaries', () => {
  it('keeps @mitii/sdk host-neutral over public @mitii/v8 only', () => {
    const sdkRoot = join(repoRoot, 'packages/sdk');
    const sdkSrc = join(sdkRoot, 'src');
    expect(existsSync(sdkRoot)).toBe(true);
    expect(existsSync(join(sdkRoot, 'package.json'))).toBe(true);

    const pkg = JSON.parse(
      readFileSync(join(sdkRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(pkg.name).toBe('@mitii/sdk');
    expect(pkg.dependencies?.['@mitii/v8']).toBeTruthy();
    expect(pkg.dependencies).not.toHaveProperty('vscode');
    expect(pkg.peerDependencies ?? {}).not.toHaveProperty('vscode');
    expect(pkg.exports).not.toHaveProperty('./daemon');

    const forbiddenSdkPatterns = [
      /from ['"]vscode['"]/,
      /from ['"].*webview(?:-ui)?(?:\/|['"])/,
      /from ['"].*(?:kernel|HeadlessAgentHost|ThunderController)(?:\/|['"])/,
      /from ['"]@mitii\/v8\/.*(?:actions|internal)(?:\/|['"])/,
      /from ['"].*packages\/v8\/src\/.*\/(?:actions|internal)(?:\/|['"])/,
      /from ['"].*\/(?:actions|internal)\/[^'"]+['"]/,
    ] as const;

    const violations = scanImports(sdkSrc, forbiddenSdkPatterns).filter(
      (line) =>
        // Allow documenting forbidden paths in comments only — scanImports
        // matches import lines; keep filter for defensive clarity.
        /from ['"]/.test(line),
    );
    expect(violations).toEqual([]);

    const index = readFileSync(join(sdkSrc, 'index.ts'), 'utf8');
    expect(index).toContain('createMitiiClient');
    expect(index).toContain('MitiiClient');
    expect(index).not.toContain('HeadlessAgentHost');
    expect(index).not.toContain('DaemonClient');
  });

  it('keeps @mitii/search-kit free of v8/sdk/host/apps', () => {
    const kitRoot = join(repoRoot, 'packages/search-kit');
    const kitSrc = join(kitRoot, 'src');
    expect(existsSync(kitRoot)).toBe(true);
    expect(existsSync(join(kitRoot, 'package.json'))).toBe(true);
    expect(existsSync(join(kitRoot, 'ARCHITECTURE.md'))).toBe(true);

    const pkg = JSON.parse(
      readFileSync(join(kitRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe('@mitii/search-kit');
    expect(pkg.dependencies?.['@mitii/v8']).toBeUndefined();
    expect(pkg.dependencies?.['@mitii/sdk']).toBeUndefined();
    expect(pkg.dependencies?.['@mitii/host']).toBeUndefined();

    const hostPkg = JSON.parse(
      readFileSync(join(repoRoot, 'packages/host/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(hostPkg.dependencies?.['@mitii/search-kit']).toBeTruthy();

    const forbidden = [
      /from ['"]@mitii\/(?:v8|sdk|host)(?:\/|['"])/,
      /from ['"]vscode['"]/,
      /from ['"].*apps\/(?:cli|vscode|daemon)/,
    ] as const;
    expect(scanImports(kitSrc, forbidden)).toEqual([]);
  });

  it('places host packages under apps/ over @mitii/sdk', () => {
    const cliRoot = join(repoRoot, 'apps/cli');
    const vscodeRoot = join(repoRoot, 'apps/vscode');
    const rootPkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as {
      private?: boolean;
      bin?: unknown;
      contributes?: unknown;
      activationEvents?: unknown;
      main?: unknown;
      engines?: { vscode?: string };
    };

    expect(rootPkg.private).toBe(true);
    expect(rootPkg.bin).toBeUndefined();
    expect(rootPkg.contributes).toBeUndefined();
    expect(rootPkg.activationEvents).toBeUndefined();
    expect(rootPkg.main).toBeUndefined();
    expect(rootPkg.engines?.vscode).toBeUndefined();

    expect(existsSync(cliRoot)).toBe(true);
    expect(existsSync(vscodeRoot)).toBe(true);
    expect(existsSync(join(repoRoot, 'packages/cli'))).toBe(false);
    expect(existsSync(join(repoRoot, 'packages/daemon'))).toBe(false);
    // Quarantined daemon lived under legacy/packages until human purge.
    expect(existsSync(join(repoRoot, 'legacy'))).toBe(false);

    const cliPkg = JSON.parse(
      readFileSync(join(cliRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(cliPkg.name).toBe('@mitii/cli');
    expect(cliPkg.bin?.mitii).toBeTruthy();
    expect(cliPkg.dependencies?.['@mitii/sdk']).toBeTruthy();
    expect(cliPkg.dependencies?.['@mitii/host']).toBeTruthy();

    const vscodePkg = JSON.parse(
      readFileSync(join(vscodeRoot, 'package.json'), 'utf8'),
    ) as {
      name: string;
      contributes?: unknown;
      activationEvents?: unknown;
      engines?: { vscode?: string };
      main?: string;
      dependencies?: Record<string, string>;
    };
    expect(vscodePkg.name).toBe('mitii-ai-agent');
    expect(vscodePkg.name).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    expect(vscodePkg.contributes).toBeTruthy();
    expect(vscodePkg.activationEvents).toBeTruthy();
    expect(vscodePkg.engines?.vscode).toBeTruthy();
    expect(vscodePkg.main).toContain('extension.js');
    expect(vscodePkg.dependencies?.['@mitii/sdk']).toBeTruthy();
    expect(vscodePkg.dependencies?.['@mitii/host']).toBeTruthy();

    const forbiddenHostPatterns = [
      /from ['"].*(?:kernel|HeadlessAgentHost|ThunderController)(?:\/|['"])/,
      /from ['"]@mitii\/v8\/.*(?:actions|internal)(?:\/|['"])/,
      /from ['"].*packages\/v8\/src\/.*\/(?:actions|internal)(?:\/|['"])/,
      /from ['"].*\/(?:actions|internal)\/[^'"]+['"]/,
    ] as const;

    expect(scanImports(join(cliRoot, 'src'), forbiddenHostPatterns)).toEqual(
      [],
    );
    expect(
      scanImports(join(vscodeRoot, 'src'), forbiddenHostPatterns),
    ).toEqual([]);

    const vscodeSrcFiles = [
      join(vscodeRoot, 'src/extension.ts'),
      join(vscodeRoot, 'src/hostAsk.ts'),
      join(vscodeRoot, 'src/ports.ts'),
      join(vscodeRoot, 'src/sidebar.ts'),
    ];
    const vscodeHostSrc = vscodeSrcFiles
      .filter((file) => existsSync(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(vscodeHostSrc).toContain('@mitii/sdk');
    // Hosts reach V8 through the SDK client, directly or via @mitii/host.
    expect(vscodeHostSrc).toMatch(/createMitiiClient|createHostClient/);
    expect(vscodeHostSrc).not.toMatch(
      /from ['"].*ThunderController['"]/,
    );

    const cliSrcFiles = [
      join(cliRoot, 'src/cli.ts'),
      join(cliRoot, 'src/ports.ts'),
      join(cliRoot, 'src/session.ts'),
    ];
    const cliHostSrc = cliSrcFiles
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(cliHostSrc).toContain('@mitii/sdk');
    expect(cliHostSrc).toMatch(/createMitiiClient|createHostClient/);
  });

  it('keeps active tree clean (no legacy vault / old roots)', () => {
    expect(existsSync(join(repoRoot, 'legacy'))).toBe(false);
    expect(existsSync(join(repoRoot, 'src'))).toBe(false);
    expect(existsSync(join(repoRoot, 'tools/benchmark'))).toBe(false);
    if (existsSync(join(repoRoot, 'tools'))) {
      const toolEntries = readdirSync(join(repoRoot, 'tools'));
      expect(
        toolEntries.filter(
          (entry) => entry !== 'policy-admin' && entry !== 'log-viewer',
        ),
      ).toEqual([]);
    }
    expect(existsSync(join(repoRoot, 'tests/benchmark/package.json'))).toBe(true);
    expect(existsSync(join(repoRoot, 'benchmark'))).toBe(false);
    expect(existsSync(join(repoRoot, 'test'))).toBe(false);

    const productRoots = [
      join(repoRoot, 'packages/v8/src'),
      join(repoRoot, 'packages/sdk/src'),
      join(repoRoot, 'apps/cli/src'),
      join(repoRoot, 'apps/vscode/src'),
    ];
    // Ban the old repo-root / package vault `legacy/` trees. The intentional
    // compat shim at `engine/v8-engine/legacy/` is allowed.
    const legacyImportPatterns = [
      /from ['"].*(?:^|\/)legacy(?:\/|['"])/,
      /from ['"].*(?:^|\/)(?:src\/kernel|src\/interfaces|src\/composition)(?:\/|['"])/,
      /require\(['"].*(?:^|\/)legacy(?:\/|['"])/,
    ] as const;
    for (const root of productRoots) {
      expect(
        scanImports(root, legacyImportPatterns).filter(
          // scanImports uses repo-style `/` paths on every OS; do not use `path.sep`.
          (line) => !line.includes('/engine/v8-engine/'),
        ),
      ).toEqual([]);
    }
  });

  it('keeps recursive pnpm filters portable across Windows and POSIX shells', () => {
    const rootPackage = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    const nonPortable = Object.entries(rootPackage.scripts ?? {}).filter(
      ([, command]) => /--filter\s+'[^']+'/.test(command),
    );
    expect(nonPortable).toEqual([]);
  });

  it('strips legacy dual brand from apps/vscode', () => {
    const vscodeRoot = join(repoRoot, 'apps/vscode');
    const pkg = JSON.parse(
      readFileSync(join(vscodeRoot, 'package.json'), 'utf8'),
    ) as {
      activationEvents?: string[];
      contributes?: {
        commands?: Array<{ command?: string }>;
        views?: Record<string, Array<{ id?: string }>>;
        viewsContainers?: { activitybar?: Array<{ id?: string }> };
        configuration?: { properties?: Record<string, unknown> };
      };
    };

    const activation = pkg.activationEvents ?? [];
    expect(activation.every((e) => !e.includes('thunder.'))).toBe(true);
    expect(activation.some((e) => e.includes('mitii.'))).toBe(true);

    const commands = pkg.contributes?.commands ?? [];
    expect(commands.every((c) => String(c.command).startsWith('mitii.'))).toBe(
      true,
    );
    expect(
      commands.some((c) => c.command === 'mitii.migrateThunderSettings'),
    ).toBe(false);
    expect(commands.some((c) => c.command === 'mitii.setApiKey')).toBe(true);
    expect(commands.some((c) => c.command === 'mitii.openChat')).toBe(true);
    expect(commands.some((c) => c.command === 'mitii.generateChangelog')).toBe(
      true,
    );

    const props = Object.keys(pkg.contributes?.configuration?.properties ?? {});
    expect(props.every((key) => key.startsWith('mitii.'))).toBe(true);
    expect(props.some((key) => key.startsWith('thunder.'))).toBe(false);
    expect(props).toEqual(
      expect.arrayContaining([
        'mitii.debug',
        'mitii.developer.modelIo',
        'mitii.provider.type',
        'mitii.provider.baseUrl',
        'mitii.provider.model',
      ]),
    );
    expect(props.some((key) => key.startsWith('mitii.mcp.'))).toBe(false);

    const viewIds = Object.values(pkg.contributes?.views ?? {})
      .flat()
      .map((v) => v.id);
    expect(viewIds).toContain('mitii.sidebar');
    expect(viewIds).not.toContain('thunder.sidebar');

    const containerIds = (
      pkg.contributes?.viewsContainers?.activitybar ?? []
    ).map((c) => c.id);
    expect(containerIds).toContain('mitii');
    expect(containerIds).not.toContain('thunder');

    const hostSrc = [
      join(vscodeRoot, 'src/extension.ts'),
      join(vscodeRoot, 'src/sidebar.ts'),
    ]
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    expect(hostSrc).not.toMatch(/thunder\./);
    expect(hostSrc).toContain('mitii.sidebar');
  });
});
