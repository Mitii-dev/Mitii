import {
  CODE_INDEX_LANGUAGE_BY_EXTENSION,
  SQLITE_CODE_INDEX_SQL,
} from "../../constants";

import {
  CodeIndexError,
  throwIfCodeIndexAborted,
} from "../../CodeIndexError";

import type { CodeIndexIdBuilder } from "../../CodeIndexIdBuilder";

import { codeIndexRelativePathSchema } from "../../schema";

import type {
  CodeIndexContext,
  SqliteCodeIndexFileRow,
  SqliteReadPort,
} from "../../types";

import type { WorkspaceFileEntry } from "../../../workspace";

/** Immutable adapter state shared by the SQLite read operations. */
export interface SqliteCodeIndexState {
  readonly adapterId: string;
  readonly database: SqliteReadPort;
  readonly workspace: string;
  readonly rootId: string;
  readonly sqlBatchSize: number;
  readonly idBuilder: CodeIndexIdBuilder;
}

export interface ResolvedRequestedFiles {
  rows: SqliteCodeIndexFileRow[];
  domainIdByDatabaseId: ReadonlyMap<number, string>;
}

export function validatePositiveInteger(
  value: number,
  name: string,
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a positive safe integer.`,
    );
  }
}

export function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}

/**
 * Returns a schema-safe workspace-relative path, or undefined when the
 * stored value is absolute / non-canonical (e.g. `/tmp/foo` shell scripts).
 * Graph build must not fail the whole index on those rows.
 */
export function toCanonicalRelativePath(
  value: string | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = codeIndexRelativePathSchema.safeParse(
    normalizePath(value),
  );

  return parsed.success ? parsed.data : undefined;
}

export function isWithinFolder(
  relativePath: string,
  folderPrefix: string,
): boolean {
  if (!folderPrefix) {
    return true;
  }

  const normalizedPath = normalizePath(relativePath);

  return (
    normalizedPath === folderPrefix ||
    normalizedPath.startsWith(`${folderPrefix}/`)
  );
}

export function createBatches<T>(
  state: SqliteCodeIndexState,
  values: readonly T[],
): T[][] {
  const batches: T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += state.sqlBatchSize
  ) {
    batches.push(
      values.slice(index, index + state.sqlBatchSize),
    );
  }

  return batches;
}

export function placeholders(count: number): string {
  if (count <= 0) {
    throw new RangeError(
      "SQL placeholder count must be positive.",
    );
  }

  return new Array(count).fill("?").join(", ");
}

export function optionalLine<Key extends string>(
  key: Key,
  value: number | null,
): Partial<Record<Key, number>> {
  return value !== null &&
    Number.isSafeInteger(value) &&
    value > 0
    ? ({ [key]: value } as Partial<Record<Key, number>>)
    : {};
}

export function languageProperty(
  relativePath: string,
): Partial<{ language: string }> {
  const extension = relativePath
    .split(".")
    .pop()
    ?.toLowerCase();

  const language = extension
    ? CODE_INDEX_LANGUAGE_BY_EXTENSION[extension]
    : undefined;

  return language ? { language } : {};
}

export function getSnapshotFiles(
  state: SqliteCodeIndexState,
  context: CodeIndexContext,
  folderPrefix = "",
): WorkspaceFileEntry[] {
  return context.snapshot.entries
    .filter(
      (entry): entry is WorkspaceFileEntry =>
        entry.kind === "file" &&
        entry.rootId === state.rootId &&
        isWithinFolder(entry.relativePath, folderPrefix),
    )
    .sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );
}

export function getSnapshotPathSet(
  state: SqliteCodeIndexState,
  context: CodeIndexContext,
): ReadonlySet<string> {
  return new Set(
    getSnapshotFiles(state, context).map((file) =>
      normalizePath(file.relativePath),
    ),
  );
}

export async function loadFileRows(
  state: SqliteCodeIndexState,
  paths: readonly string[],
  context: CodeIndexContext,
): Promise<SqliteCodeIndexFileRow[]> {
  const rows: SqliteCodeIndexFileRow[] = [];

  for (const batch of createBatches(state, paths)) {
    throwIfCodeIndexAborted(context.abortSignal);

    const batchRows = state.database
      .prepare(
        `${SQLITE_CODE_INDEX_SQL.GET_FILES_PREFIX}
           (${placeholders(batch.length)})
           ORDER BY rel_path`,
      )
      .all(
        state.workspace,
        ...batch,
      ) as SqliteCodeIndexFileRow[];

    rows.push(...batchRows);
  }

  return rows;
}

export async function resolveRequestedFiles(
  state: SqliteCodeIndexState,
  fileIds: readonly string[],
  context: CodeIndexContext,
): Promise<ResolvedRequestedFiles> {
  const domainIdByPath = new Map<string, string>();

  for (const fileId of fileIds) {
    const identity = state.idBuilder.parseFileId(fileId);

    if (!identity || identity.rootId !== state.rootId) {
      continue;
    }

    domainIdByPath.set(identity.relativePath, fileId);
  }

  const rows = await loadFileRows(
    state,
    [...domainIdByPath.keys()],
    context,
  );

  const domainIdByDatabaseId = new Map<number, string>();

  for (const row of rows) {
    const domainId = domainIdByPath.get(
      normalizePath(row.relativePath),
    );

    if (domainId) {
      domainIdByDatabaseId.set(row.id, domainId);
    }
  }

  return { rows, domainIdByDatabaseId };
}

export function isAbortError(error: unknown): error is Error {
  return (
    error instanceof Error && error.name === "AbortError"
  );
}

function formatCauseMessage(
  cause: unknown,
): string | undefined {
  if (!cause) {
    return undefined;
  }

  if (cause instanceof Error) {
    const zodIssues = (
      cause as Error & {
        issues?: ReadonlyArray<{
          path: ReadonlyArray<string | number>;
          message: string;
        }>;
      }
    ).issues;

    if (Array.isArray(zodIssues) && zodIssues.length > 0) {
      const first = zodIssues[0]!;
      const path =
        first.path.length > 0
          ? `${first.path.join(".")}: `
          : "";
      return `(${path}${first.message})`;
    }

    return `(${cause.message})`;
  }

  return `(${String(cause)})`;
}

export function createSqliteCodeIndexError(
  state: SqliteCodeIndexState,
  message: string,
  operation: CodeIndexError["operation"],
  cause: unknown,
): CodeIndexError {
  const causeMessage = formatCauseMessage(cause);

  return new CodeIndexError(
    causeMessage ? `${message} ${causeMessage}` : message,
    {
      operation,
      adapterId: state.adapterId,
      cause,
    },
  );
}

export function normalizeSqliteCodeIndexError(
  state: SqliteCodeIndexState,
  error: unknown,
  message: string,
  operation: CodeIndexError["operation"],
): Error {
  if (isAbortError(error) || error instanceof CodeIndexError) {
    return error;
  }

  return createSqliteCodeIndexError(
    state,
    message,
    operation,
    error,
  );
}
