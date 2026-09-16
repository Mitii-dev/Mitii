import type { ReviewChangedFile } from "../contracts";
import { extensionOf, normalizeRelativePath } from "./pathUtils";

export interface ScanBatch {
  label: string;
  paths: string[];
}

/**
 * Deterministic scan batching: group by language (extension), then chunk.
 */
export function batchScanFiles(
  files: readonly ReviewChangedFile[],
  batchSize: number,
): ScanBatch[] {
  const size = Math.max(1, batchSize);
  const byExt = new Map<string, string[]>();
  for (const file of files) {
    const path = normalizeRelativePath(file.path);
    const ext = extensionOf(path) || "(none)";
    const list = byExt.get(ext) ?? [];
    list.push(path);
    byExt.set(ext, list);
  }

  const batches: ScanBatch[] = [];
  const exts = [...byExt.keys()].sort();
  for (const ext of exts) {
    const paths = (byExt.get(ext) ?? []).sort();
    for (let i = 0; i < paths.length; i += size) {
      const chunk = paths.slice(i, i + size);
      batches.push({
        label: `scan ${ext} ${Math.floor(i / size) + 1}`,
        paths: chunk,
      });
    }
  }
  return batches;
}
