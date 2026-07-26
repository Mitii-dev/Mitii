const { build } = require('esbuild');
const { createRequire } = require('node:module');
const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const root = join(__dirname, '..');
const outfile = join(root, 'dist/cli.js');
const requireFromApp = createRequire(join(root, 'package.json'));

mkdirSync(dirname(outfile), { recursive: true });

build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  banner: {
    js: "import { createRequire as __mitiiCreateRequire } from 'node:module'; const require = __mitiiCreateRequire(import.meta.url);",
  },
  plugins: [
    {
      name: 'workspace-node-resolve',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('node:')) {
            return { path: args.path, external: true };
          }
          // Keep Node builtins external.
          if (
            [
              'fs',
              'path',
              'url',
              'module',
              'crypto',
              'child_process',
              'os',
              'util',
              'stream',
              'events',
              'buffer',
              'process',
            ].includes(args.path)
          ) {
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
