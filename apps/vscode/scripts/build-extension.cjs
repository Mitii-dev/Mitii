const { build } = require('esbuild');
const { createRequire } = require('node:module');
const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const root = join(__dirname, '..');
const outfile = join(root, 'dist/extension.js');
const requireFromApp = createRequire(join(root, 'package.json'));

mkdirSync(dirname(outfile), { recursive: true });

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
        // Resolve bare imports via this package's pnpm links so a user-home
        // Yarn .pnp.cjs cannot veto workspace packages.
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
