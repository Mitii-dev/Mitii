/**
 * Shared Index Pipeline Health — Code / FTS / Embeddings / Graph / native.
 *
 * Reads `.mitii/index-runtime.json`, progress/lock, and light on-disk probes so
 * CLI, Desktop, and VS Code can show which pipeline is ready vs failed.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { resolveRuntimeFilename } from '../internal/resolveRuntimeFilename.js';
import {
  isIndexLockHeld,
  readIndexProgress,
  type IndexProgressSnapshot,
} from './indexLock.js';
import {
  readIndexRuntimeMetadata,
  type IndexRuntimeMetadata,
} from './semanticIndex.js';
import {
  ONNX_RUNTIME_NODE_PACKAGE,
  ONNX_RUNTIME_WEB_PACKAGE,
} from './bundled-embedding/constants.js';

export const INDEX_PIPELINE_HEALTH_SCHEMA_VERSION = 1 as const;

export type IndexPipelineStatus =
  | 'ready'
  | 'degraded'
  | 'unavailable'
  | 'running'
  | 'pending'
  | 'missing';

export type IndexOverallHealth =
  | 'ready'
  | 'lexical_only'
  | 'running'
  | 'failed'
  | 'missing';

export interface IndexPipelineEntry {
  status: IndexPipelineStatus;
  reason?: string;
  revision?: string;
  profileId?: string;
}

export interface IndexNativeHealth {
  sqlite: 'ready' | 'unavailable' | 'unknown';
  lancedb: 'ready' | 'unavailable' | 'unknown';
  onnx: 'native' | 'wasm' | 'unavailable' | 'unknown';
}

export interface IndexPipelineHealth {
  schemaVersion: typeof INDEX_PIPELINE_HEALTH_SCHEMA_VERSION;
  overall: IndexOverallHealth;
  workspaceId?: string;
  generatedAt?: string;
  running: boolean;
  progress?: {
    stage: string;
    message: string;
    percent: number;
    lexicalReady?: boolean;
    embeddingPhase?: string;
  };
  pipelines: {
    codeIndex: IndexPipelineEntry;
    textFts: IndexPipelineEntry;
    embeddings: IndexPipelineEntry;
    graph: IndexPipelineEntry;
    map: IndexPipelineEntry;
    treeSitter: IndexPipelineEntry;
  };
  native: IndexNativeHealth;
  counts: {
    files: number;
    truncated: boolean;
  };
  paths: {
    mitiiDir: string;
    sqlitePath?: string;
    lanceDbPath?: string;
  };
  lastError?: string;
}

export interface ReadIndexPipelineHealthOptions {
  workspaceRoot: string;
  /** Default `.mitii` under workspaceRoot. */
  mitiiDir?: string;
  /**
   * Probe optional native packages (LanceDB / ONNX). Default true.
   * Disable in hot UI loops if needed.
   */
  probeNative?: boolean;
}

const INDEX_RUNTIME_FILE = 'index-runtime.json';
const INDEX_DB_FILE = 'repository-index.sqlite';
const LANCEDB_DIR = 'lancedb';

function entry(
  status: IndexPipelineStatus,
  extras: Omit<IndexPipelineEntry, 'status'> = {},
): IndexPipelineEntry {
  return {
    status,
    ...extras,
  };
}

function firstRoot(meta: IndexRuntimeMetadata | undefined) {
  return meta?.lastIndexingResult?.rootResults?.[0];
}

function deriveCodeIndex(
  meta: IndexRuntimeMetadata | undefined,
  progress: IndexProgressSnapshot | undefined,
  running: boolean,
): IndexPipelineEntry {
  if (running && progress && !progress.lexicalReady) {
    return entry('running', { reason: progress.message });
  }
  const root = firstRoot(meta);
  const revision =
    root?.codeIndexRevision !== undefined
      ? String(root.codeIndexRevision)
      : meta?.catalogRevisionByRoot
        ? Object.values(meta.catalogRevisionByRoot)[0]
        : undefined;
  if (root?.codeIndexRevision !== undefined) {
    if (root.status === 'partial') {
      return entry('degraded', {
        reason: 'code_index_partial',
        revision: String(root.codeIndexRevision),
      });
    }
    return entry('ready', { revision: String(root.codeIndexRevision) });
  }
  if (meta && existsSync(meta.sqlitePath)) {
    return entry('ready', {
      reason: 'sqlite_present',
      ...(revision ? { revision } : {}),
    });
  }
  if (!meta) return entry('missing', { reason: 'index_runtime_missing' });
  return entry('unavailable', { reason: 'code_index_revision_missing' });
}

function deriveTextFts(
  meta: IndexRuntimeMetadata | undefined,
  progress: IndexProgressSnapshot | undefined,
  running: boolean,
): IndexPipelineEntry {
  if (running && progress && !progress.lexicalReady) {
    return entry('running', { reason: progress.message });
  }
  const root = firstRoot(meta);
  const revision =
    root?.finalTextRevision ??
    root?.latestTextRevision ??
    root?.initialTextRevision;
  if (revision !== undefined) {
    if (root?.status === 'partial') {
      return entry('degraded', {
        reason: 'text_index_partial',
        revision: String(revision),
      });
    }
    return entry('ready', { revision: String(revision) });
  }
  if (meta?.textIndexSchemaVersion !== undefined && existsSync(meta.sqlitePath)) {
    return entry('ready', {
      reason: 'fts_schema_present',
      revision: String(meta.textIndexSchemaVersion),
    });
  }
  if (!meta) return entry('missing', { reason: 'index_runtime_missing' });
  return entry('unavailable', { reason: 'text_index_revision_missing' });
}

function deriveEmbeddings(
  meta: IndexRuntimeMetadata | undefined,
  progress: IndexProgressSnapshot | undefined,
  running: boolean,
): IndexPipelineEntry {
  const phase = progress?.embeddingPhase;
  if (running && (phase === 'running' || phase === 'pending')) {
    return entry(phase === 'running' ? 'running' : 'pending', {
      reason: progress?.message,
      ...(meta?.embeddingProfile?.id
        ? { profileId: meta.embeddingProfile.id }
        : {}),
    });
  }
  if (meta?.lastEmbeddingError) {
    return entry('degraded', {
      reason: meta.lastEmbeddingError,
      ...(meta.embeddingProfile?.id
        ? { profileId: meta.embeddingProfile.id }
        : {}),
    });
  }
  const root = firstRoot(meta);
  if (
    root?.embeddingStatus === 'complete' ||
    root?.embeddingStatus === 'unchanged'
  ) {
    return entry('ready', {
      ...(root.embeddingProfileId
        ? { profileId: root.embeddingProfileId }
        : meta?.embeddingProfile?.id
          ? { profileId: meta.embeddingProfile.id }
          : {}),
    });
  }
  if (root?.embeddingStatus === 'partial') {
    return entry('degraded', {
      reason: 'embedding_partial',
      ...(root.embeddingProfileId ? { profileId: root.embeddingProfileId } : {}),
    });
  }
  if (meta?.embeddingProfile?.id && meta.lanceDbPath && existsSync(meta.lanceDbPath)) {
    return entry('ready', { profileId: meta.embeddingProfile.id });
  }
  if (!meta) return entry('missing', { reason: 'index_runtime_missing' });
  if (phase === 'unavailable' || !meta.embeddingProfile) {
    return entry('unavailable', {
      reason: meta.lastEmbeddingError ?? 'embeddings_not_configured_or_not_built',
    });
  }
  return entry('unavailable', {
    reason: 'embedding_profile_or_lancedb_missing',
    ...(meta.embeddingProfile?.id
      ? { profileId: meta.embeddingProfile.id }
      : {}),
  });
}

function deriveGraph(meta: IndexRuntimeMetadata | undefined): IndexPipelineEntry {
  const revision = meta?.graphRevisionByRoot
    ? Object.values(meta.graphRevisionByRoot)[0]
    : undefined;
  if (revision) return entry('ready', { revision });
  if (!meta) return entry('missing');
  return entry('unavailable', { reason: 'graph_revision_missing' });
}

function deriveMap(meta: IndexRuntimeMetadata | undefined): IndexPipelineEntry {
  const revision = meta?.mapRevisionByRoot
    ? Object.values(meta.mapRevisionByRoot)[0]
    : undefined;
  if (revision) return entry('ready', { revision });
  if (!meta) return entry('missing');
  return entry('unavailable', { reason: 'map_revision_missing' });
}

function deriveTreeSitter(
  meta: IndexRuntimeMetadata | undefined,
): IndexPipelineEntry {
  if (meta?.treeSitterRuntime === 'ready') {
    return entry('ready');
  }
  if (meta?.treeSitterRuntime === 'unavailable') {
    return entry('unavailable', { reason: 'tree_sitter_unavailable' });
  }
  if (!meta) return entry('missing');
  return entry('unavailable', { reason: 'tree_sitter_status_unknown' });
}

function canResolvePackage(packageId: string): boolean {
  try {
    createRequire(resolveRuntimeFilename()).resolve(packageId);
    return true;
  } catch {
    try {
      createRequire(join(process.cwd(), 'package.json')).resolve(packageId);
      return true;
    } catch {
      return false;
    }
  }
}

function probeNativeModules(options: {
  sqlitePath?: string;
  lanceDbPath?: string;
}): IndexNativeHealth {
  const sqlite =
    options.sqlitePath && existsSync(options.sqlitePath)
      ? 'ready'
      : canResolvePackage('better-sqlite3')
        ? 'ready'
        : 'unavailable';

  let lancedb: IndexNativeHealth['lancedb'] = 'unknown';
  if (options.lanceDbPath && existsSync(options.lanceDbPath)) {
    lancedb = 'ready';
  } else if (canResolvePackage('@lancedb/lancedb')) {
    lancedb = 'ready';
  } else {
    lancedb = 'unavailable';
  }

  let onnx: IndexNativeHealth['onnx'] = 'unavailable';
  if (canResolvePackage(ONNX_RUNTIME_NODE_PACKAGE)) {
    onnx = 'native';
  } else if (canResolvePackage(ONNX_RUNTIME_WEB_PACKAGE)) {
    onnx = 'wasm';
  }

  return { sqlite, lancedb, onnx };
}

function resolveOverall(input: {
  running: boolean;
  meta: IndexRuntimeMetadata | undefined;
  sqliteExists: boolean;
  code: IndexPipelineEntry;
  text: IndexPipelineEntry;
  embeddings: IndexPipelineEntry;
}): IndexOverallHealth {
  if (input.running) return 'running';
  if (!input.meta && !input.sqliteExists) return 'missing';

  const lexicalOk =
    (input.code.status === 'ready' || input.code.status === 'degraded') &&
    (input.text.status === 'ready' || input.text.status === 'degraded');

  if (!lexicalOk) {
    if (
      input.code.status === 'missing' &&
      input.text.status === 'missing' &&
      !input.sqliteExists
    ) {
      return 'missing';
    }
    return 'failed';
  }

  if (input.embeddings.status === 'ready') return 'ready';
  if (
    input.embeddings.status === 'running' ||
    input.embeddings.status === 'pending'
  ) {
    return 'lexical_only';
  }
  // Embeddings disabled / not built / degraded — agent can still use FTS.
  return 'lexical_only';
}

/**
 * Read durable + live index pipeline health for a workspace.
 */
export function readIndexPipelineHealth(
  options: ReadIndexPipelineHealthOptions,
): IndexPipelineHealth {
  const mitiiDir = options.mitiiDir ?? join(options.workspaceRoot, '.mitii');
  const runtimePath = join(mitiiDir, INDEX_RUNTIME_FILE);
  const meta = readIndexRuntimeMetadata(runtimePath);
  const lock = isIndexLockHeld(mitiiDir);
  const progress = lock.held ? readIndexProgress(mitiiDir) : undefined;
  const running = lock.held;

  const sqlitePath =
    meta?.sqlitePath ?? join(mitiiDir, INDEX_DB_FILE);
  const lanceDbPath = meta?.lanceDbPath ?? join(mitiiDir, LANCEDB_DIR);
  const sqliteExists = existsSync(sqlitePath);

  const codeIndex = deriveCodeIndex(meta, progress, running);
  const textFts = deriveTextFts(meta, progress, running);
  const embeddings = deriveEmbeddings(meta, progress, running);
  const graph = deriveGraph(meta);
  const map = deriveMap(meta);
  const treeSitter = deriveTreeSitter(meta);

  const probeNative = options.probeNative !== false;
  const native = probeNative
    ? probeNativeModules({ sqlitePath, lanceDbPath })
    : { sqlite: 'unknown' as const, lancedb: 'unknown' as const, onnx: 'unknown' as const };

  const overall = resolveOverall({
    running,
    meta,
    sqliteExists,
    code: codeIndex,
    text: textFts,
    embeddings,
  });

  const lastError = meta?.lastEmbeddingError;

  return {
    schemaVersion: INDEX_PIPELINE_HEALTH_SCHEMA_VERSION,
    overall,
    ...(meta?.workspaceId ? { workspaceId: meta.workspaceId } : {}),
    ...(meta?.generatedAt ? { generatedAt: meta.generatedAt } : {}),
    running,
    ...(progress
      ? {
          progress: {
            stage: progress.stage,
            message: progress.message,
            percent: progress.percent,
            ...(progress.lexicalReady ? { lexicalReady: true } : {}),
            ...(progress.embeddingPhase
              ? { embeddingPhase: progress.embeddingPhase }
              : {}),
          },
        }
      : {}),
    pipelines: {
      codeIndex,
      textFts,
      embeddings,
      graph,
      map,
      treeSitter,
    },
    native,
    counts: {
      files: meta?.fileCount ?? progress?.fileCount ?? 0,
      truncated: Boolean(meta?.truncated),
    },
    paths: {
      mitiiDir,
      ...(sqliteExists || meta ? { sqlitePath } : {}),
      ...(existsSync(lanceDbPath) || meta ? { lanceDbPath } : {}),
    },
    ...(lastError ? { lastError } : {}),
  };
}

const PIPELINE_LABELS: Record<keyof IndexPipelineHealth['pipelines'], string> = {
  codeIndex: 'Code Index',
  textFts: 'Text FTS5',
  embeddings: 'Embeddings',
  graph: 'Graph',
  map: 'Map',
  treeSitter: 'Tree-sitter',
};

function formatEntry(label: string, pipeline: IndexPipelineEntry): string {
  const bits = [
    pipeline.revision ? `revision=${pipeline.revision}` : undefined,
    pipeline.profileId ? `profile=${pipeline.profileId}` : undefined,
    pipeline.reason ? `reason=${pipeline.reason}` : undefined,
  ].filter(Boolean);
  return `${label}=${pipeline.status}${bits.length ? ` ${bits.join(' ')}` : ''}`;
}

/** Human-readable lines for CLI / logs. */
export function formatIndexPipelineHealthLines(
  health: IndexPipelineHealth,
): string[] {
  const lines: string[] = [
    `indexHealth overall=${health.overall} files=${health.counts.files}${health.counts.truncated ? ' truncated' : ''}${health.running ? ' running' : ''}`,
  ];
  if (health.progress) {
    lines.push(
      `progress stage=${health.progress.stage} percent=${health.progress.percent}${health.progress.lexicalReady ? ' lexicalReady' : ''}${health.progress.embeddingPhase ? ` embedding=${health.progress.embeddingPhase}` : ''} — ${health.progress.message}`,
    );
  }
  for (const key of Object.keys(PIPELINE_LABELS) as Array<
    keyof typeof PIPELINE_LABELS
  >) {
    lines.push(formatEntry(PIPELINE_LABELS[key], health.pipelines[key]));
  }
  lines.push(
    `native sqlite=${health.native.sqlite} lancedb=${health.native.lancedb} onnx=${health.native.onnx}`,
  );
  if (health.lastError) {
    lines.push(`lastError=${health.lastError}`);
  }
  return lines;
}
