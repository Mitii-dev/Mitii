import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { IgnoreService } from '../indexing/IgnoreService';
import type { DiscoveredFile } from '../indexing/FileDiscoveryService';
import { isBinaryByExtension, detectLanguage } from '../indexing/fileUtils';
import type { IndexingConfig } from '../config/schema';

/** File discovery without VS Code configuration APIs — used by headless host and benchmarks. */
export function headlessDiscoverFiles(
  workspacePath: string,
  ignoreService: IgnoreService,
  config: Pick<IndexingConfig, 'hardSkipSizeBytes'>
): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = join(dir, entry);
      const relPath = relative(workspacePath, absPath).replace(/\\/g, '/');

      if (ignoreService.isIgnored(relPath)) continue;

      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(absPath);
        continue;
      }

      if (!stat.isFile()) continue;
      if (stat.size > config.hardSkipSizeBytes) continue;
      if (isBinaryByExtension(relPath)) continue;

      results.push({
        absPath,
        relPath,
        size: stat.size,
        mtime: stat.mtimeMs,
        language: detectLanguage(relPath),
      });
    }
  };

  walk(workspacePath);
  return results;
}
