import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Filename suitable for `createRequire()` and asset-relative paths.
 *
 * Must not be called with raw `import.meta.url` at module load: the VS Code
 * extension is esbuild-bundled as CJS where `import.meta.url` is undefined.
 */
export function resolveRuntimeFilename(): string {
  try {
    const metaUrl =
      typeof import.meta !== 'undefined' &&
      typeof import.meta.url === 'string' &&
      import.meta.url.length > 0
        ? import.meta.url
        : undefined;
    if (metaUrl) {
      return fileURLToPath(metaUrl);
    }
  } catch {
    // CJS host bundles may throw or leave import.meta.url undefined.
  }

  const cjsFilename =
    typeof __filename !== 'undefined' ? __filename : undefined;
  if (typeof cjsFilename === 'string' && cjsFilename.length > 0) {
    return cjsFilename;
  }

  return join(process.cwd(), 'package.json');
}
