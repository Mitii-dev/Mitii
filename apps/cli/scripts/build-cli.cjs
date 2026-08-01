const { build } = require('esbuild');
const { createRequire } = require('node:module');
const { builtinModules } = require('node:module');
const { cpSync, mkdirSync, rmSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

const root = join(__dirname, '..');
const outfile = join(root, 'dist/cli.js');
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
]);

mkdirSync(dirname(outfile), { recursive: true });

function stageBundledSkills() {
  const source = resolve(__dirname, '../../../packages/sdk/skills');
  const target = join(root, 'dist/skills');
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  console.log(`staged ${target}`);
}

build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  external: ['@lancedb/lancedb', 'better-sqlite3', 'typescript', 'vscode'],
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
    stageBundledSkills();
    console.log(`built ${outfile}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
