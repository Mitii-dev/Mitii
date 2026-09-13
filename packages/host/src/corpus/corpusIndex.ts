import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export const CORPUS_DIR_NAME = 'corpus';
export const CORPUS_INDEX_FILE = 'index.json';
export const CORPUS_INDEX_SCHEMA_VERSION = 1 as const;

const CORPUS_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text']);
const MAX_FILES = 500;
const MAX_FILE_BYTES = 256_000;
const CHUNK_CHARS = 800;
const CHUNK_OVERLAP = 80;
const MAX_EXCERPT = 400;

export interface CorpusChunk {
  id: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
}

export interface CorpusFileEntry {
  relativePath: string;
  size: number;
  contentHash: string;
  chunks: CorpusChunk[];
}

export interface CorpusIndex {
  schemaVersion: typeof CORPUS_INDEX_SCHEMA_VERSION;
  generatedAt: string;
  rootRelativePath: string;
  files: CorpusFileEntry[];
  statistics: {
    files: number;
    chunks: number;
    truncated: boolean;
  };
}

export function corpusDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, '.mitii', CORPUS_DIR_NAME);
}

export function corpusIndexPath(workspaceRoot: string): string {
  return join(corpusDirectory(workspaceRoot), CORPUS_INDEX_FILE);
}

export function corpusIndexExists(workspaceRoot: string): boolean {
  return existsSync(corpusIndexPath(workspaceRoot));
}

/** Load `.mitii/corpus/index.json` or return undefined when missing/invalid. */
export async function loadCorpusIndex(
  workspaceRoot: string,
): Promise<CorpusIndex | undefined> {
  const path = corpusIndexPath(workspaceRoot);
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as CorpusIndex;
    if (
      !parsed ||
      parsed.schemaVersion !== CORPUS_INDEX_SCHEMA_VERSION ||
      !Array.isArray(parsed.files)
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Index markdown/text under `.mitii/corpus/` into `.mitii/corpus/index.json`.
 * v1: simple file list + chunk excerpts (no LanceDB).
 */
export async function runCorpusIndex(input: {
  workspaceRoot: string;
  now?: Date;
}): Promise<CorpusIndex> {
  const corpusRoot = corpusDirectory(input.workspaceRoot);
  await mkdir(corpusRoot, { recursive: true });

  const files: CorpusFileEntry[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      if (truncated) return;
      if (name === CORPUS_INDEX_FILE) continue;
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!info.isFile()) continue;
      const lower = name.toLowerCase();
      const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
      if (!CORPUS_EXTENSIONS.has(ext)) continue;
      if (info.size > MAX_FILE_BYTES) {
        truncated = true;
        continue;
      }

      const relativePath = relative(input.workspaceRoot, full).replace(
        /\\/g,
        '/',
      );
      let content: string;
      try {
        content = await readFile(full, 'utf8');
      } catch {
        continue;
      }
      const contentHash = createHash('sha256')
        .update(content)
        .digest('hex')
        .slice(0, 16);
      files.push({
        relativePath,
        size: info.size,
        contentHash,
        chunks: chunkText(relativePath, content),
      });
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
    }
  }

  await walk(corpusRoot);

  const index: CorpusIndex = {
    schemaVersion: CORPUS_INDEX_SCHEMA_VERSION,
    generatedAt: (input.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    rootRelativePath: `.mitii/${CORPUS_DIR_NAME}`,
    files,
    statistics: {
      files: files.length,
      chunks: files.reduce((sum, file) => sum + file.chunks.length, 0),
      truncated,
    },
  };

  const outPath = corpusIndexPath(input.workspaceRoot);
  await mkdir(dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await rename(tempPath, outPath);
  return index;
}

function chunkText(relativePath: string, content: string): CorpusChunk[] {
  const normalized = content.replace(/\r\n/g, '\n');
  if (normalized.trim().length === 0) {
    return [];
  }
  const chunks: CorpusChunk[] = [];
  let offset = 0;
  let index = 0;
  while (offset < normalized.length) {
    const end = Math.min(normalized.length, offset + CHUNK_CHARS);
    const slice = normalized.slice(offset, end);
    const excerpt =
      slice.length > MAX_EXCERPT
        ? `${slice.slice(0, MAX_EXCERPT - 1)}…`
        : slice;
    const idSeed = `${relativePath}:${offset}:${end}`;
    chunks.push({
      id: `corpus_${createHash('sha256').update(idSeed).digest('hex').slice(0, 12)}`,
      startOffset: offset,
      endOffset: end,
      excerpt,
    });
    index += 1;
    if (end >= normalized.length) break;
    offset = Math.max(offset + 1, end - CHUNK_OVERLAP);
    if (index > 2_000) break;
  }
  return chunks;
}
