#!/usr/bin/env node
/**
 * Stage onnxruntime-node native binaries and onnxruntime-web WASM into
 * apps/vscode/dist/native/onnxruntime so the extension host can load them
 * without a static require (package audit forbids unresolved requires).
 *
 * Copies every platform folder present in the installed package. Marketplace
 * VSIXs stay per-target; WASM is the cross-platform fallback.
 */
const { cpSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const { dirname, join, parse } = require('node:path');
const { createRequire } = require('node:module');

const PACKAGES = ['onnxruntime-node', 'onnxruntime-common', 'onnxruntime-web'];

function packageRootFromEntry(entryPath, packageName) {
  let dir = dirname(entryPath);
  const { root } = parse(dir);
  while (dir !== root) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        if (require(manifest).name === packageName) {
          return dir;
        }
      } catch {
        // continue walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

function resolveFrom(moduleId, packageName) {
  const req = createRequire(moduleId);
  // Prefer package.json when exported (onnxruntime-node). Packages with a
  // restrictive "exports" map (onnxruntime-web) reject package.json and need
  // a walk up from the resolved entry.
  try {
    return dirname(req.resolve(`${packageName}/package.json`));
  } catch {
    // fall through
  }
  try {
    return packageRootFromEntry(req.resolve(packageName), packageName);
  } catch {
    return undefined;
  }
}

function stageOnnxRuntime(
  targetDir = join(__dirname, '../apps/vscode/dist/native/onnxruntime/node_modules'),
) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const hostPkg = join(__dirname, '../packages/host/package.json');
  const vscodePkg = join(__dirname, '../apps/vscode/package.json');
  const cliPkg = join(__dirname, '../apps/cli/package.json');
  let staged = 0;

  for (const packageName of PACKAGES) {
    const source =
      resolveFrom(vscodePkg, packageName) ||
      resolveFrom(hostPkg, packageName) ||
      resolveFrom(cliPkg, packageName);
    if (!source) {
      console.warn(`${packageName} not found; skipping ONNX staging for it`);
      continue;
    }
    cpSync(source, join(targetDir, packageName), {
      recursive: true,
      dereference: true,
      filter: (path) =>
        !path.includes(`${packageName}/node_modules`) &&
        !path.endsWith('.md') &&
        !path.includes('/docs/'),
    });
    staged += 1;
    console.log(`staged ${packageName} from ${source}`);
  }

  if (staged === 0) {
    console.warn(
      'ONNX Runtime packages were not installed. Bundled MiniLM will be unavailable until onnxruntime-node or onnxruntime-web is present.',
    );
    return false;
  }

  console.log(`staged ONNX Runtime to ${targetDir}`);
  return true;
}

module.exports = { stageOnnxRuntime };

if (require.main === module) {
  stageOnnxRuntime();
}
