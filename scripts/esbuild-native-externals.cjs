/**
 * Native / optional Node addons that must stay external to esbuild bundles.
 * Used by CLI and Desktop engine builds (they ship with node_modules).
 *
 * VS Code VSIX uses --no-dependencies: use isOptionalVscodeNativeExternal
 * instead, and keep typescript / better-sqlite3 / web-tree-sitter bundled.
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

/**
 * Optional .node addons the VS Code extension may probe at runtime.
 * Soft-fail paths use WASM tree-sitter / CLI git when these are absent.
 * Must not include packages the VSIX bundles (typescript, better-sqlite3, …).
 *
 * @param {string} path bare import path
 */
function isOptionalVscodeNativeExternal(path) {
  if (path === 'tree-sitter' || path === 'es-git') {
    return true;
  }
  if (path.startsWith('es-git-')) {
    return true;
  }
  // Native grammar packages only — not the WASM asset package.
  if (path === 'tree-sitter-wasms' || path.startsWith('tree-sitter-wasms/')) {
    return false;
  }
  if (path.startsWith('tree-sitter-')) {
    return true;
  }
  return false;
}

module.exports = {
  NATIVE_EXTERNALS,
  isNativeExternal,
  isOptionalVscodeNativeExternal,
};
