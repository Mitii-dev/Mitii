const { builtinModules } = require('node:module');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const allowedExternalRequires = new Set([
  'vscode',
  // Bundled TypeScript optionally probes this in a guarded try/catch.
  'source-map-support',
]);
const failures = [];

function fail(message) {
  failures.push(message);
}

function assertFile(path, label) {
  if (!existsSync(path)) {
    fail(`missing ${label}: ${path}`);
    return;
  }
  if (!statSync(path).isFile()) {
    fail(`${label} is not a file: ${path}`);
  }
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(pkg.name)) {
  fail(`package.json name must be a VS Code extension id segment, got "${pkg.name}"`);
}

if (pkg.name.includes('/') || pkg.name.startsWith('@')) {
  fail(`package.json name must not be npm-scoped for VS Code publishing, got "${pkg.name}"`);
}

assertFile(join(dist, 'extension.js'), 'extension bundle');
assertFile(join(dist, 'webview', 'index.html'), 'webview index');
assertFile(join(dist, 'webview', 'main.js'), 'webview script');
assertFile(join(dist, 'webview', 'main.css'), 'webview style');
assertFile(join(dist, 'native', 'better_sqlite3.node'), 'SQLite native binding');
assertFile(
  join(dist, 'skills', 'planning-default', 'SKILL.md'),
  'bundled planning skill',
);
assertFile(
  join(dist, 'skills', 'safety-always', 'SKILL.md'),
  'bundled safety skill',
);

const bundlePath = join(dist, 'extension.js');
if (existsSync(bundlePath)) {
  const bundle = readFileSync(bundlePath, 'utf8');
  if (/\/\/# sourceMappingURL=.+\s*$/.test(bundle)) {
    fail('production extension bundle must not contain a sourceMappingURL');
  }
  for (const match of bundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
    const request = match[1];
    if (
      request.startsWith('.') ||
      builtins.has(request) ||
      allowedExternalRequires.has(request)
    ) {
      continue;
    }
    fail(`unresolved runtime require in extension bundle: ${request}`);
  }
}

for (const forbidden of [
  join(root, 'dist', 'extension.js.map'),
  join(root, 'dist', 'webview', 'main.js.map'),
]) {
  if (existsSync(forbidden)) {
    fail(`source map should not be present in production package output: ${forbidden}`);
  }
}

if (failures.length > 0) {
  console.error('VS Code package audit failed:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log('VS Code package audit passed.');
