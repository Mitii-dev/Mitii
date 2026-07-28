const { build } = require('esbuild');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { builtinModules } = require('node:module');
const { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const outfile = join(root, 'dist/extension.js');
const webviewDir = join(root, 'webview-ui');
const requireFromApp = createRequire(join(root, 'package.json'));
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const externals = new Set(['vscode']);

function buildWebview() {
  const viteBin = join(webviewDir, 'node_modules', 'vite', 'bin', 'vite.js');
  const pnpmArgs = ['exec', 'vite', 'build'];
  const useLocalVite = existsSync(viteBin);
  const result = useLocalVite
    ? spawnSync(process.execPath, [viteBin, 'build'], {
        cwd: webviewDir,
        stdio: 'inherit',
        env: process.env,
      })
    : spawnSync('pnpm', pnpmArgs, {
        cwd: webviewDir,
        stdio: 'inherit',
        env: process.env,
        shell: process.platform === 'win32',
      });
  if (result.status !== 0) {
    throw new Error('webview build failed');
  }
  console.log(`built ${join(root, 'dist/webview')}`);
}

function moduleRoot(name) {
  return dirname(requireFromApp.resolve(`${name}/package.json`));
}

function stageNativeSqliteBinding() {
  const betterSqliteRoot = moduleRoot('better-sqlite3');
  const candidates = [
    join(betterSqliteRoot, 'build', 'Release', 'better_sqlite3.node'),
    join(
      betterSqliteRoot,
      'bin',
      `${process.platform}-${process.arch}-${process.versions.modules}`,
      'better-sqlite3.node',
    ),
  ];
  const source = candidates.find((candidate) => existsSync(candidate));
  if (!source) {
    throw new Error(
      `Could not find a better-sqlite3 native binding. Checked: ${candidates.join(', ')}`,
    );
  }
  const nativeDir = join(distDir, 'native');
  const target = join(nativeDir, 'better_sqlite3.node');
  mkdirSync(nativeDir, { recursive: true });
  copyFileSync(source, target);
  console.log(`staged native SQLite binding ${target}`);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(dirname(outfile), { recursive: true });

buildWebview();

build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/extension.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: production,
  sourcemap: production ? false : 'external',
  sourcesContent: false,
  legalComments: 'none',
  metafile: true,
  external: ['vscode'],
  plugins: [
    {
      name: 'workspace-node-resolve',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^[^./]/ }, (args) => {
          if (builtins.has(args.path) || externals.has(args.path)) {
            return { path: args.path, external: true };
          }
          try {
            return { path: requireFromApp.resolve(args.path) };
          } catch {
            return undefined;
          }
        });
      },
    },
  ],
  logLevel: production ? 'warning' : 'info',
})
  .then((result) => {
    if (result.metafile) {
      writeFileSync(
        join(distDir, 'extension.meta.json'),
        `${JSON.stringify(result.metafile, null, 2)}\n`,
      );
    }
    stageNativeSqliteBinding();
    console.log(`built ${outfile}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
