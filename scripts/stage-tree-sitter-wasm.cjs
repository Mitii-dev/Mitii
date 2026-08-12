const { cpSync, existsSync, mkdirSync, readdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { createRequire } = require('node:module');

const GRAMMARS = [
  'tree-sitter-c.wasm',
  'tree-sitter-c_sharp.wasm',
  'tree-sitter-cpp.wasm',
  'tree-sitter-go.wasm',
  'tree-sitter-java.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-kotlin.wasm',
  'tree-sitter-php.wasm',
  'tree-sitter-python.wasm',
  'tree-sitter-ruby.wasm',
  'tree-sitter-rust.wasm',
  'tree-sitter-swift.wasm',
  'tree-sitter-tsx.wasm',
  'tree-sitter-typescript.wasm',
];

function resolveFrom(moduleId, candidates) {
  const req = createRequire(moduleId);
  for (const candidate of candidates) {
    try {
      return req.resolve(candidate);
    } catch {
      continue;
    }
  }
  return undefined;
}

function stageTreeSitterWasm(targetDir = join(__dirname, '../apps/vscode/dist/tree-sitter')) {
  mkdirSync(targetDir, { recursive: true });
  const hostPkg = join(__dirname, '../packages/host/package.json');
  const vscodePkg = join(__dirname, '../apps/vscode/package.json');
  const coreWasm = resolveFrom(hostPkg, [
    'web-tree-sitter/tree-sitter.wasm',
    'web-tree-sitter/web-tree-sitter.wasm',
  ]) || resolveFrom(vscodePkg, [
    'web-tree-sitter/tree-sitter.wasm',
    'web-tree-sitter/web-tree-sitter.wasm',
  ]);

  if (!coreWasm) {
    console.warn('tree-sitter core wasm not found; skipping WASM staging');
    return false;
  }

  cpSync(coreWasm, join(targetDir, 'tree-sitter.wasm'));

  const grammarDir = dirname(
    resolveFrom(hostPkg, ['tree-sitter-wasms/out/tree-sitter-python.wasm']) ||
      resolveFrom(vscodePkg, ['tree-sitter-wasms/out/tree-sitter-python.wasm']) ||
      '',
  );

  if (!grammarDir || !existsSync(grammarDir)) {
    console.warn('tree-sitter-wasms grammar directory not found; staged core wasm only');
    return true;
  }

  const available = new Set(readdirSync(grammarDir));
  for (const grammar of GRAMMARS) {
    if (!available.has(grammar)) continue;
    cpSync(join(grammarDir, grammar), join(targetDir, grammar));
  }

  console.log(`staged tree-sitter wasm to ${targetDir}`);
  return true;
}

module.exports = { stageTreeSitterWasm };

if (require.main === module) {
  stageTreeSitterWasm();
}
