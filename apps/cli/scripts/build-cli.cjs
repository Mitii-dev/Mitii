const { build } = require('esbuild');
const { createRequire } = require('node:module');
const { builtinModules } = require('node:module');
const { cpSync, mkdirSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { rmRf } = require(resolve(__dirname, '../../../scripts/rm-rf.cjs'));
const {
  isNativeExternal,
} = require(resolve(__dirname, '../../../scripts/esbuild-native-externals.cjs'));

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
  // web-tree-sitter uses __dirname in Parser.init; bundling into ESM breaks it.
  'web-tree-sitter',
  'tree-sitter-wasms',
  // Native optional addons — never bundle .node binaries.
  'tree-sitter',
  'es-git',
  'typescript',
  'vscode',
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
  entryPoints: [join(root, 'src/cli.ts')],
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
          if (
            builtins.has(args.path) ||
            externals.has(args.path) ||
            isNativeExternal(args.path, externals)
          ) {
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
