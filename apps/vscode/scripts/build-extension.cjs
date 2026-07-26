const { build } = require('esbuild');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { mkdirSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');

const root = join(__dirname, '..');
const outfile = join(root, 'dist/extension.js');
const webviewDir = join(root, 'webview-ui');
const requireFromApp = createRequire(join(root, 'package.json'));

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
  sourcemap: true,
  external: ['vscode'],
  plugins: [
    {
      name: 'workspace-node-resolve',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path === 'vscode' || args.path.startsWith('node:')) {
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
  logLevel: 'info',
})
  .then(() => {
    console.log(`built ${outfile}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
