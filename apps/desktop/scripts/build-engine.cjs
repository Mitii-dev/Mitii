/**
 * Bundle mitii-desktop-engine for Node ESM.
 *
 * @mitii/sdk and @mitii/v8 emit extensionless imports (tsconfig moduleResolution:
 * "bundler"). Bare Node cannot load them — same reason apps/cli uses esbuild.
 */
const { build } = require('esbuild');
const { createRequire } = require('node:module');
const { builtinModules } = require('node:module');
const { cpSync, mkdirSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { rmRf } = require(resolve(__dirname, '../../../scripts/rm-rf.cjs'));

const root = join(__dirname, '..');
const outfile = join(root, 'dist/engine/main.js');
const requireFromApp = createRequire(join(root, 'package.json'));
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const externals = new Set([
  '@lancedb/lancedb',
  'better-sqlite3',
  'typescript',
  'vscode',
  'electron',
]);

mkdirSync(dirname(outfile), { recursive: true });

function resolveBareImport(args) {
  if (args.importer) {
    try {
      return createRequire(args.importer).resolve(args.path);
    } catch {
      // Fall back to the app package for entry-point and shared dependency imports.
    }
  }
  return requireFromApp.resolve(args.path);
}

function stageBundledSkills() {
  const source = resolve(__dirname, '../../../packages/sdk/skills');
  const target = join(root, 'dist/skills');
  rmRf(target);
  cpSync(source, target, { recursive: true });
  console.log(`staged ${target}`);
}

build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/engine/main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: [...externals],
  banner: {
    js: "import { createRequire as __mitiiCreateRequire } from 'node:module'; const require = __mitiiCreateRequire(import.meta.url);",
  },
  plugins: [
    {
      name: 'workspace-node-resolve',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^[^./]/ }, (args) => {
          if (builtins.has(args.path) || externals.has(args.path)) {
            return { path: args.path, external: true };
          }
          try {
            return { path: resolveBareImport(args) };
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
    stageBundledSkills();
    console.log(`built ${outfile}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
