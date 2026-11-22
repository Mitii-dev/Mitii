/**
 * Native / optional Node addons that must stay external to esbuild bundles.
 * Used by CLI, Desktop engine, and VS Code extension builds.
 */

const NATIVE_EXTERNALS = [
  '@lancedb/lancedb',
  'better-sqlite3',
  'web-tree-sitter',
  'tree-sitter-wasms',
  'tree-sitter',
  'es-git',
  'typescript',
  'vscode',
  'electron',
  'onnxruntime-node',
  'onnxruntime-web',
  '@vscode/ripgrep',
  '@ast-grep/cli',
  '@scip-code/scip',
  '@bufbuild/protobuf',
];

/**
 * @param {string} path bare import path
 * @param {ReadonlySet<string>} [extra]
 */
function isNativeExternal(path, extra) {
  if (extra?.has(path) || NATIVE_EXTERNALS.includes(path)) {
    return true;
  }
  // Platform packages: es-git-darwin-arm64, es-git-linux-x64-gnu, …
  if (path.startsWith('es-git-')) {
    return true;
  }
  // Language grammars: tree-sitter-python, tree-sitter-typescript/tsx, …
  if (path === 'tree-sitter' || path.startsWith('tree-sitter-')) {
    return true;
  }
  // Platform ripgrep / ast-grep native packages
  if (path.startsWith('@vscode/ripgrep-') || path.startsWith('@ast-grep/cli-')) {
    return true;
  }
  return false;
}

module.exports = {
  NATIVE_EXTERNALS,
  isNativeExternal,
};
