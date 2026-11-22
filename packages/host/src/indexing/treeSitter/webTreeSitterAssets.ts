import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { resolveRuntimeFilename } from '../../internal/resolveRuntimeFilename.js';

function treeSitterAssetRoots(): string[] {
  const roots: string[] = [];
  const configuredRoot = process.env.MITII_TREE_SITTER_ASSET_ROOT;
  if (configuredRoot) {
    roots.push(configuredRoot);
  }
  const moduleDir = dirname(resolveRuntimeFilename());
  roots.push(join(moduleDir, 'tree-sitter'));
  roots.push(join(moduleDir, '..', 'tree-sitter'));
  roots.push(join(moduleDir, '..', '..', 'tree-sitter'));
  return roots;
}

function resolveWithNodeRequire(candidate: string): string | undefined {
  try {
    return createRequire(resolveRuntimeFilename()).resolve(candidate);
  } catch {
    return undefined;
  }
}

export function resolveTreeSitterPackageAsset(
  candidates: readonly string[],
): string | undefined {
  for (const candidate of candidates) {
    const resolved = resolveWithNodeRequire(candidate);
    if (resolved) {
      return resolved;
    }

    const basename = candidate.split('/').pop();
    if (!basename) continue;
    for (const root of treeSitterAssetRoots()) {
      const nested = join(root, candidate);
      const direct = join(root, basename);
      if (existsSync(nested)) return nested;
      if (existsSync(direct)) return direct;
    }
  }

  return undefined;
}
