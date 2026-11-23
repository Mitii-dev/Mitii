import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isNativeExternal,
  isOptionalVscodeNativeExternal,
  isVscodeMustBundle,
} = require('./esbuild-native-externals.cjs');

test('isVscodeMustBundle covers VSIX runtime packages and subpaths', () => {
  assert.equal(isVscodeMustBundle('typescript'), true);
  assert.equal(isVscodeMustBundle('typescript/lib/tsserverlibrary'), true);
  assert.equal(isVscodeMustBundle('better-sqlite3'), true);
  assert.equal(isVscodeMustBundle('tree-sitter'), false);
});

test('isOptionalVscodeNativeExternal keeps VSIX-bundled packages internal', () => {
  for (const path of [
    'typescript',
    'better-sqlite3',
    'web-tree-sitter',
    'tree-sitter-wasms',
    'onnxruntime-node',
    'onnxruntime-web',
    '@vscode/ripgrep',
    '@ast-grep/cli',
  ]) {
    assert.equal(
      isOptionalVscodeNativeExternal(path),
      false,
      `${path} must be bundled into the VS Code extension`,
    );
  }
});

test('isOptionalVscodeNativeExternal allows optional native probes', () => {
  for (const path of [
    'tree-sitter',
    'tree-sitter-python',
    'tree-sitter-typescript/typescript',
    'es-git',
    'es-git-darwin-arm64',
  ]) {
    assert.equal(
      isOptionalVscodeNativeExternal(path),
      true,
      `${path} may stay external and soft-fail at runtime`,
    );
  }
});

test('isNativeExternal still covers CLI/desktop natives including typescript', () => {
  assert.equal(isNativeExternal('typescript'), true);
  assert.equal(isNativeExternal('better-sqlite3'), true);
  assert.equal(isNativeExternal('es-git-linux-x64-gnu'), true);
});
