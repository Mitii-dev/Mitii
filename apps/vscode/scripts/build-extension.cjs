const { build } = require('esbuild');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { builtinModules } = require('node:module');
const {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const {
  stageNativeSqliteBinding,
} = require(resolve(__dirname, '../../../scripts/stage-native-sqlite.cjs'));
const {
  stageTreeSitterWasm,
} = require(resolve(__dirname, '../../../scripts/stage-tree-sitter-wasm.cjs'));
const {
  stageOnnxRuntime,
} = require(resolve(__dirname, '../../../scripts/stage-onnxruntime.cjs'));

const root = join(__dirname, '..');
const distDir = join(root, 'dist');
const outfile = join(root, 'dist/extension.js');
const webviewDir = join(root, 'webview-ui');
const requireFromApp = createRequire(join(root, 'package.json'));
const production =
  process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const externals = new Set(['vscode', '@lancedb/lancedb']);

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

function stageBundledSkills() {
  const source = resolve(__dirname, '../../../packages/sdk/skills');
  const target = join(distDir, 'skills');
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  console.log(`staged ${target}`);
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
  external: ['vscode', '@lancedb/lancedb'],
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
    stageTreeSitterWasm(join(distDir, 'tree-sitter'));
    stageOnnxRuntime(join(distDir, 'native', 'onnxruntime', 'node_modules'));
    stageBundledSkills();
    console.log(`built ${outfile}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
