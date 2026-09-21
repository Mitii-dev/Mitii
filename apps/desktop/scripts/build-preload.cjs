/**
 * Bundle Electron preload as CommonJS.
 * Sandboxed preloads need CJS when the package is "type": "module".
 */
const { build } = require('esbuild');
const { mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const root = join(__dirname, '..');
const outfile = join(root, 'dist/preload/index.cjs');

mkdirSync(dirname(outfile), { recursive: true });

build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/preload/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
})
  .then(() => {
    console.log(`built ${outfile}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
